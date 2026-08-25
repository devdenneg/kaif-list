import {
  ActivityType,
  SOCKET_EVENTS,
  TASK_LINK_INVERSE,
  TaskLinkType,
  rooms,
  type TaskLinkDto,
} from '@kaif/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import {
  assertCanTask,
  loadBoardContext,
  type RequestUser,
  type TaskContext,
} from '../../lib/rbac.js';
import { mapTaskLink, taskLinkSelect } from '../../lib/mappers.js';
import { recordActivity } from '../../services/activity.js';
import { publishRealtime } from '../../realtime/bridge.js';

/**
 * Связи между задачами.
 *
 * Связь всегда двусторонняя: создаём прямую и обратную запись,
 * чтобы обе задачи «знали» друг о друге. Счётчик блокеров денормализован —
 * по нему проверяется запрет закрывать заблокированную задачу.
 */

export async function createTaskLink(
  user: RequestUser,
  context: TaskContext,
  input: { type: TaskLinkType; targetTaskId?: string; targetTaskKey?: string },
): Promise<TaskLinkDto> {
  assertCanTask(user, context, 'task.link.manage');

  const target = await prisma.task.findFirst({
    where: input.targetTaskId
      ? { id: input.targetTaskId }
      : { key: input.targetTaskKey?.toUpperCase() ?? '' },
    select: { id: true, boardId: true, key: true },
  });
  if (!target) throw new NotFoundError('Связываемая задача не найдена');
  if (target.id === context.task.id) throw new BadRequestError('Нельзя связать задачу саму с собой');

  // Связывать можно только задачи, к которым у пользователя есть доступ.
  if (target.boardId !== context.board.id) {
    await loadBoardContext(user, target.boardId);
  }

  const existing = await prisma.taskLink.findUnique({
    where: {
      fromTaskId_toTaskId_type: {
        fromTaskId: context.task.id,
        toTaskId: target.id,
        type: input.type,
      },
    },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Такая связь уже существует');

  if (input.type === TaskLinkType.BLOCKED_BY || input.type === TaskLinkType.BLOCKS) {
    await assertNoCycle(context.task.id, target.id, input.type);
  }

  const link = await prisma.$transaction(async (tx) => {
    const created = await tx.taskLink.create({
      data: { fromTaskId: context.task.id, toTaskId: target.id, type: input.type },
      select: taskLinkSelect,
    });

    await tx.taskLink.upsert({
      where: {
        fromTaskId_toTaskId_type: {
          fromTaskId: target.id,
          toTaskId: context.task.id,
          type: TASK_LINK_INVERSE[input.type],
        },
      },
      create: {
        fromTaskId: target.id,
        toTaskId: context.task.id,
        type: TASK_LINK_INVERSE[input.type],
      },
      update: {},
    });

    await refreshBlockedCount(tx, context.task.id);
    await refreshBlockedCount(tx, target.id);

    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.TASK_LINK_ADDED,
      payload: { type: input.type, targetKey: target.key },
    });

    return created;
  });

  await publishRealtime({
    room: rooms.task(context.task.id),
    event: SOCKET_EVENTS.TASK_UPDATED,
    data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id, fields: ['links'] },
  });

  return mapTaskLink(link);
}

export async function deleteTaskLink(
  user: RequestUser,
  context: TaskContext,
  linkId: string,
): Promise<void> {
  assertCanTask(user, context, 'task.link.manage');

  const link = await prisma.taskLink.findFirst({
    where: { id: linkId, fromTaskId: context.task.id },
    select: { id: true, toTaskId: true, type: true },
  });
  if (!link) throw new NotFoundError('Связь не найдена');

  await prisma.$transaction(async (tx) => {
    await tx.taskLink.delete({ where: { id: linkId } });
    await tx.taskLink.deleteMany({
      where: {
        fromTaskId: link.toTaskId,
        toTaskId: context.task.id,
        type: TASK_LINK_INVERSE[link.type],
      },
    });
    await refreshBlockedCount(tx, context.task.id);
    await refreshBlockedCount(tx, link.toTaskId);
    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.TASK_LINK_REMOVED,
      payload: { type: link.type },
    });
  });

  await publishRealtime({
    room: rooms.task(context.task.id),
    event: SOCKET_EVENTS.TASK_UPDATED,
    data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id, fields: ['links'] },
  });
}

async function refreshBlockedCount(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  const count = await tx.taskLink.count({
    where: {
      fromTaskId: taskId,
      type: TaskLinkType.BLOCKED_BY,
      toTask: { archivedAt: null, columnKey: { not: 'DONE' } },
    },
  });
  await tx.task.update({ where: { id: taskId }, data: { blockedByCount: count } });
}

/**
 * Защита от циклов в блокирующих связях: A блокирует B, B блокирует A —
 * это гарантированный тупик, при котором ни одну задачу нельзя закрыть.
 */
async function assertNoCycle(
  fromTaskId: string,
  toTaskId: string,
  type: TaskLinkType,
): Promise<void> {
  const direction = type === TaskLinkType.BLOCKS ? TaskLinkType.BLOCKS : TaskLinkType.BLOCKED_BY;
  const start = type === TaskLinkType.BLOCKS ? toTaskId : fromTaskId;
  const goal = type === TaskLinkType.BLOCKS ? fromTaskId : toTaskId;

  const visited = new Set<string>([start]);
  let frontier = [start];

  for (let depth = 0; depth < 20 && frontier.length > 0; depth += 1) {
    const links = await prisma.taskLink.findMany({
      where: { fromTaskId: { in: frontier }, type: direction },
      select: { toTaskId: true },
    });
    const next: string[] = [];
    for (const link of links) {
      if (link.toTaskId === goal) {
        throw new ConflictError(
          'Такая связь создаст цикл блокировок — задачи заблокируют друг друга',
          'LINK_CYCLE',
        );
      }
      if (!visited.has(link.toTaskId)) {
        visited.add(link.toTaskId);
        next.push(link.toTaskId);
      }
    }
    frontier = next;
  }
}
