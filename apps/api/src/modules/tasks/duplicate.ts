import {
  ActivityType,
  SOCKET_EVENTS,
  ranksBetween,
  rooms,
  type DuplicateTaskInput,
  type TaskDetailDto,
} from '@kaif/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { assertCanTask, type RequestUser, type TaskContext } from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { openInitialTransition } from '../../services/flow-metrics.js';
import { syncCoreParticipants } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { getTaskDetail } from './service.js';

/**
 * Дублирование задачи.
 *
 * Нужно чаще, чем кажется: одинаковые задачи на нескольких людей,
 * повторяющиеся регламентные работы, разбиение большой задачи на копии.
 * Копируем содержание, но не историю: комментарии и вложения остаются
 * у оригинала — иначе получилась бы копия чужого обсуждения.
 */
export async function duplicateTask(
  user: RequestUser,
  context: TaskContext,
  input: DuplicateTaskInput,
): Promise<TaskDetailDto> {
  assertCanTask(user, context, 'task.create');

  const source = await prisma.task.findUnique({
    where: { id: context.task.id },
    select: {
      title: true,
      descriptionJson: true,
      descriptionText: true,
      type: true,
      priority: true,
      columnKey: true,
      rank: true,
      isBacklog: true,
      assigneeId: true,
      testerId: true,
      storyPoints: true,
      estimateMinutes: true,
      dueDate: true,
      labels: { select: { labelId: true } },
      checklists: {
        orderBy: { rank: 'asc' },
        select: {
          title: true,
          rank: true,
          items: { orderBy: { rank: 'asc' }, select: { text: true, rank: true } },
        },
      },
    },
  });
  if (!source) throw new NotFoundError('Задача не найдена', 'TASK_NOT_FOUND');

  const createdIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    // Копии встают сразу после оригинала, чтобы их не пришлось искать.
    const next = await tx.task.findFirst({
      where: {
        boardId: context.board.id,
        columnKey: source.columnKey,
        isBacklog: source.isBacklog,
        archivedAt: null,
        rank: { gt: source.rank },
      },
      orderBy: { rank: 'asc' },
      select: { rank: true },
    });
    const ranks = ranksBetween(source.rank, next?.rank ?? null, input.count);

    for (let index = 0; index < input.count; index += 1) {
      const board = await tx.board.update({
        where: { id: context.board.id },
        data: { taskCounter: { increment: 1 } },
        select: { key: true, taskCounter: true },
      });
      const number = board.taskCounter;
      const key = `${board.key}-${number}`;

      const title =
        input.count > 1
          ? `${input.title ?? source.title} (${index + 1})`
          : (input.title ?? `Копия: ${source.title}`.slice(0, 200));

      const descriptionText = input.includeDescription ? source.descriptionText : '';

      const created = await tx.task.create({
        data: {
          boardId: context.board.id,
          number,
          key,
          title: title.slice(0, 200),
          descriptionJson:
            input.includeDescription && source.descriptionJson
              ? (source.descriptionJson as Prisma.InputJsonValue)
              : Prisma.DbNull,
          descriptionText,
          searchText: `${key} ${title} ${descriptionText}`.toLowerCase().slice(0, 8000),
          type: source.type,
          priority: source.priority,
          columnKey: source.columnKey,
          rank: ranks[index] ?? source.rank,
          isBacklog: source.isBacklog,
          reporterId: user.id,
          assigneeId: input.includeAssignee ? source.assigneeId : null,
          testerId: input.includeAssignee ? source.testerId : null,
          storyPoints: source.storyPoints,
          estimateMinutes: source.estimateMinutes,
          dueDate: input.includeDueDate ? source.dueDate : null,
          ...(input.includeLabels && source.labels.length > 0
            ? { labels: { create: source.labels.map((label) => ({ labelId: label.labelId })) } }
            : {}),
        },
        select: { id: true },
      });

      if (input.includeChecklists && source.checklists.length > 0) {
        let total = 0;
        for (const checklist of source.checklists) {
          const createdList = await tx.checklist.create({
            data: { taskId: created.id, title: checklist.title, rank: checklist.rank },
            select: { id: true },
          });
          if (checklist.items.length === 0) continue;
          await tx.checklistItem.createMany({
            data: checklist.items.map((item) => ({
              checklistId: createdList.id,
              text: item.text,
              rank: item.rank,
            })),
          });
          total += checklist.items.length;
        }
        if (total > 0) {
          await tx.task.update({ where: { id: created.id }, data: { checklistTotal: total } });
        }
      }

      await syncCoreParticipants(tx, created.id, {
        reporterId: user.id,
        assigneeId: input.includeAssignee ? source.assigneeId : null,
        testerId: input.includeAssignee ? source.testerId : null,
      });

      // Копия начинает жить в той же колонке, что и оригинал: отсчёт
      // времени в колонке должен идти с этого момента, а не с нуля.
      await openInitialTransition(tx, {
        taskId: created.id,
        boardId: context.board.id,
        columnKey: source.columnKey,
        actorId: user.id,
        at: new Date(),
      });

      await recordActivity(tx, {
        boardId: context.board.id,
        taskId: created.id,
        actorId: user.id,
        type: ActivityType.TASK_CREATED,
        payload: {
          key,
          title,
          columnKey: source.columnKey,
          isBacklog: source.isBacklog,
          duplicatedFrom: context.task.key,
        },
      });

      createdIds.push(created.id);
    }
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.TASK_CREATED,
    data: { boardId: context.board.id, actorId: user.id },
  });

  const firstId = createdIds[0];
  if (!firstId) throw new NotFoundError('Не удалось создать копию');
  return getTaskDetail(user, firstId);
}
