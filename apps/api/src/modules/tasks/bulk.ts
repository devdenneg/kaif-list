import {
  ActivityType,
  ColumnKey,
  NotificationType,
  ParticipantRole,
  SOCKET_EVENTS,
  rankAfter,
  rooms,
  type BulkTaskActionInput,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../lib/errors.js';
import { assertCan, type BoardContext, type RequestUser } from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification } from '../../services/notify.js';
import { publishRealtime } from '../../realtime/bridge.js';

/**
 * Массовые операции над задачами — сердце «банка задач» (бэклога):
 * выделил десяток задач, назначил на человека, проставил приоритет,
 * отправил на доску.
 */
export async function bulkTaskAction(
  user: RequestUser,
  context: BoardContext,
  input: BulkTaskActionInput,
): Promise<{ affected: number }> {
  assertCan(user, context, 'backlog.manage');

  const tasks = await prisma.task.findMany({
    where: { id: { in: input.taskIds }, boardId: context.board.id },
    select: { id: true, key: true, title: true, assigneeId: true, columnKey: true },
  });
  if (tasks.length === 0) return { affected: 0 };
  const taskIds = tasks.map((t) => t.id);

  switch (input.action) {
    case 'assign': {
      if (input.assigneeId) {
        const member = await prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId: context.board.id, userId: input.assigneeId } },
          select: { userId: true },
        });
        if (!member) throw new BadRequestError('Можно назначать только участников доски');
      }

      await prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { id: { in: taskIds } },
          data: { assigneeId: input.assigneeId ?? null, lastActivityAt: new Date() },
        });
        if (input.assigneeId) {
          for (const task of tasks) {
            await tx.taskParticipant.upsert({
              where: {
                taskId_userId_role: {
                  taskId: task.id,
                  userId: input.assigneeId,
                  role: ParticipantRole.ASSIGNEE,
                },
              },
              create: { taskId: task.id, userId: input.assigneeId, role: ParticipantRole.ASSIGNEE },
              update: {},
            });
          }
        }
        await recordActivity(tx, {
          boardId: context.board.id,
          actorId: user.id,
          type: ActivityType.TASK_ASSIGNED,
          payload: { bulk: true, count: taskIds.length, assigneeId: input.assigneeId ?? null },
        });
      });

      if (input.assigneeId && input.assigneeId !== user.id) {
        for (const task of tasks) {
          await dispatchNotification({
            type: NotificationType.TASK_ASSIGNED_TO_YOU,
            recipientIds: [input.assigneeId],
            actorId: user.id,
            boardId: context.board.id,
            taskId: task.id,
            payload: {
              taskKey: task.key,
              taskTitle: task.title,
              boardName: context.board.name,
              actorName: user.displayName,
            },
          });
        }
      }
      break;
    }

    case 'setPriority': {
      if (!input.priority) throw new BadRequestError('Не указан приоритет');
      await prisma.task.updateMany({
        where: { id: { in: taskIds } },
        data: { priority: input.priority, lastActivityAt: new Date() },
      });
      break;
    }

    case 'addLabel': {
      if (!input.labelId) throw new BadRequestError('Не указана метка');
      await assertLabelBelongsToBoard(context.board.id, input.labelId);
      await prisma.taskLabel.createMany({
        data: taskIds.map((taskId) => ({ taskId, labelId: input.labelId as string })),
        skipDuplicates: true,
      });
      break;
    }

    case 'removeLabel': {
      if (!input.labelId) throw new BadRequestError('Не указана метка');
      await prisma.taskLabel.deleteMany({
        where: { taskId: { in: taskIds }, labelId: input.labelId },
      });
      break;
    }

    case 'moveToBoard': {
      const columnKey = input.columnKey ?? ColumnKey.TODO;
      await prisma.$transaction(async (tx) => {
        let last = await tx.task.findFirst({
          where: { boardId: context.board.id, columnKey, isBacklog: false, archivedAt: null },
          orderBy: { rank: 'desc' },
          select: { rank: true },
        });
        for (const task of tasks) {
          const rank = rankAfter(last?.rank ?? null);
          await tx.task.update({
            where: { id: task.id },
            data: { isBacklog: false, columnKey, rank, lastActivityAt: new Date() },
          });
          last = { rank };
        }
        await recordActivity(tx, {
          boardId: context.board.id,
          actorId: user.id,
          type: ActivityType.TASK_MOVED_TO_BOARD,
          payload: { bulk: true, count: taskIds.length, columnKey },
        });
      });
      break;
    }

    case 'moveToBacklog': {
      await prisma.$transaction(async (tx) => {
        let last = await tx.task.findFirst({
          where: { boardId: context.board.id, isBacklog: true, archivedAt: null },
          orderBy: { rank: 'desc' },
          select: { rank: true },
        });
        for (const task of tasks) {
          const rank = rankAfter(last?.rank ?? null);
          await tx.task.update({
            where: { id: task.id },
            data: { isBacklog: true, rank, lastActivityAt: new Date() },
          });
          last = { rank };
        }
        await recordActivity(tx, {
          boardId: context.board.id,
          actorId: user.id,
          type: ActivityType.TASK_MOVED_TO_BACKLOG,
          payload: { bulk: true, count: taskIds.length },
        });
      });
      break;
    }

    case 'archive': {
      await prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { id: { in: taskIds } },
          data: { archivedAt: new Date() },
        });
        await recordActivity(tx, {
          boardId: context.board.id,
          actorId: user.id,
          type: ActivityType.TASK_ARCHIVED,
          payload: { bulk: true, count: taskIds.length, reason: input.reason ?? null },
        });
      });
      break;
    }

    default:
      throw new BadRequestError('Неизвестное действие');
  }

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_UPDATED,
    data: { boardId: context.board.id, bulk: true },
  });

  return { affected: tasks.length };
}

async function assertLabelBelongsToBoard(boardId: string, labelId: string): Promise<void> {
  const label = await prisma.label.findFirst({
    where: { id: labelId, boardId },
    select: { id: true },
  });
  if (!label) throw new BadRequestError('Метка не найдена на этой доске');
}
