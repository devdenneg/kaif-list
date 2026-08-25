import {
  ActivityType,
  COLUMN_LABELS,
  COLUMN_PIPELINE_RANK,
  ColumnKey,
  NotificationType,
  SOCKET_EVENTS,
  docFromText,
  isValidReason,
  moveRequiresReason,
  rooms,
  type MoveTaskInput,
  type TaskDetailDto,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, ReasonRequiredError } from '../../lib/errors.js';
import { assertCanTask, type RequestUser, type TaskContext } from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { recordColumnTransition } from '../../services/flow-metrics.js';
import { dispatchNotification, taskRecipients } from '../../services/notify.js';
import { ensureContributor, syncCoreParticipants } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { computeRank } from './rank.js';
import { syncBlockedByBlocker } from './links.js';
import { getTaskDetail } from './service.js';

/**
 * Перенос задачи между колонками.
 *
 * Здесь живёт главное правило процесса: задачу нельзя молча остановить
 * или откатить назад. Пауза и возврат требуют письменного объяснения,
 * которое навсегда сохраняется в истории задачи системным комментарием
 * и уходит участникам в Telegram.
 */
export async function moveTask(
  user: RequestUser,
  context: TaskContext,
  input: MoveTaskInput,
): Promise<TaskDetailDto> {
  assertCanTask(user, context, 'task.move');

  const from = context.task.columnKey as ColumnKey;
  const to = input.toColumn;
  const settings = context.board.settings;
  const wasBacklog = context.task.isBacklog;
  const toBacklog = input.toBacklog ?? wasBacklog;

  if (toBacklog !== wasBacklog) {
    assertCanTask(user, context, 'backlog.manage');
  }

  const requirement = moveRequiresReason(from, to, settings);
  const reason = input.reason?.trim() ?? '';
  if (requirement.required && !isValidReason(reason)) {
    throw new ReasonRequiredError(requirement.code ?? 'MOVE_BACKWARD', requirement.message ?? '');
  }

  const current = await prisma.task.findUnique({
    where: { id: context.task.id },
    select: {
      id: true,
      key: true,
      title: true,
      columnKey: true,
      rank: true,
      isBacklog: true,
      assigneeId: true,
      testerId: true,
      reporterId: true,
      blockedByCount: true,
      priority: true,
    },
  });
  if (!current) throw new BadRequestError('Задача не найдена');

  // Ничего не изменилось — не создаём мусорных записей в истории.
  if (current.columnKey === to && current.isBacklog === toBacklog && !input.beforeTaskId && !input.afterTaskId) {
    return getTaskDetail(user, context.task.id);
  }

  await enforceColumnRules(context, current, to, toBacklog);

  const now = new Date();
  const isBackward = COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
  const isPause = to === ColumnKey.ON_HOLD && from !== ColumnKey.ON_HOLD;

  // Кто взял задачу в работу — тот и исполнитель, если он не задан.
  const shouldAutoAssign =
    settings.autoAssignOnStart &&
    to === ColumnKey.IN_PROGRESS &&
    !current.assigneeId &&
    !toBacklog;

  await prisma.$transaction(async (tx) => {
    const rank = await computeRank(tx, {
      boardId: context.board.id,
      columnKey: to,
      isBacklog: toBacklog,
      beforeTaskId: input.beforeTaskId ?? null,
      afterTaskId: input.afterTaskId ?? null,
      excludeTaskId: context.task.id,
    });

    await tx.task.update({
      where: { id: context.task.id },
      data: {
        columnKey: to,
        rank,
        isBacklog: toBacklog,
        lastActivityAt: now,
        completedAt: to === ColumnKey.DONE ? now : null,
        ...(shouldAutoAssign ? { assigneeId: user.id } : {}),
      },
    });

    if (shouldAutoAssign) {
      await syncCoreParticipants(
        tx,
        context.task.id,
        { reporterId: current.reporterId, assigneeId: user.id, testerId: current.testerId },
        { assigneeId: current.assigneeId, testerId: current.testerId },
      );
    }
    await ensureContributor(tx, context.task.id, user.id);

    // Объяснение сохраняем системным комментарием — оно должно быть видно
    // прямо в обсуждении задачи, а не только в служебном логе.
    if (requirement.required && reason) {
      await tx.comment.create({
        data: {
          taskId: context.task.id,
          authorId: user.id,
          kind: 'SYSTEM',
          bodyJson: docFromText(reason) as object,
          bodyText: reason,
          systemMeta: {
            kind: 'MOVE',
            from,
            to,
            reasonCode: requirement.code ?? null,
          } as object,
        },
      });
      await tx.task.update({
        where: { id: context.task.id },
        data: { commentCount: { increment: 1 } },
      });
    }

    // История перемещений: по ней считаются время в колонке, возвраты
    // и узкие места. Пишем здесь же, чтобы отрезок не потерялся при сбое.
    await recordColumnTransition(tx, {
      taskId: context.task.id,
      boardId: context.board.id,
      fromColumn: from,
      toColumn: to,
      actorId: user.id,
      backward: isBackward,
      isPause,
      reasonCode: requirement.code ?? null,
      at: now,
    });

    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type:
        toBacklog !== wasBacklog
          ? toBacklog
            ? ActivityType.TASK_MOVED_TO_BACKLOG
            : ActivityType.TASK_MOVED_TO_BOARD
          : ActivityType.TASK_MOVED,
      payload: {
        from,
        to,
        fromLabel: COLUMN_LABELS[from],
        toLabel: COLUMN_LABELS[to],
        reason: reason || null,
        backward: isBackward,
        isPause,
      },
    });
  });

  // Статус изменился — значит, у задач, которые ждут эту, могла пропасть
  // (или появиться) блокировка. Тем, кого это касается, уходит уведомление.
  await syncBlockedByBlocker(context.task.id, user.id);

  await publishRealtime([
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_MOVED,
      data: {
        boardId: context.board.id,
        taskId: context.task.id,
        fromColumn: from,
        toColumn: to,
        actorId: user.id,
        reason: reason || null,
      },
    },
    {
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id },
    },
  ]);

  const recipients = await taskRecipients(context.task.id, { excludeUserId: user.id });
  if (recipients.length > 0) {
    const type = isPause
      ? NotificationType.TASK_PUT_ON_HOLD
      : isBackward
        ? NotificationType.TASK_RETURNED
        : NotificationType.TASK_STATUS_CHANGED;

    await dispatchNotification({
      type,
      recipientIds: recipients,
      actorId: user.id,
      boardId: context.board.id,
      taskId: context.task.id,
      payload: {
        taskKey: current.key,
        taskTitle: current.title,
        boardName: context.board.name,
        actorName: user.displayName,
        fromColumn: from,
        toColumn: to,
        reason: reason || null,
        priority: current.priority,
      },
    });
  }

  return getTaskDetail(user, context.task.id);
}

/**
 * Правила колонок: WIP-лимиты, обязательный тестировщик для QA,
 * запрет закрывать заблокированную задачу.
 */
async function enforceColumnRules(
  context: TaskContext,
  current: { testerId: string | null; blockedByCount: number; columnKey: ColumnKey },
  to: ColumnKey,
  toBacklog: boolean,
): Promise<void> {
  const settings = context.board.settings;
  if (toBacklog) return;

  if (to === ColumnKey.QA && settings.requireTesterForQa && !current.testerId) {
    throw new BadRequestError('Перед отправкой в тестирование назначьте тестировщика', {
      testerId: 'Назначьте тестировщика',
    });
  }

  if (to === ColumnKey.DONE && settings.blockDoneWhenBlocked) {
    const blockers = await prisma.taskLink.count({
      where: {
        fromTaskId: context.task.id,
        type: 'BLOCKED_BY',
        toTask: { archivedAt: null, columnKey: { not: ColumnKey.DONE } },
      },
    });
    if (blockers > 0) {
      throw new ConflictError(
        `Задачу нельзя закрыть: есть незакрытые блокирующие задачи (${blockers})`,
        'TASK_BLOCKED',
      );
    }
  }

  const limit = settings.wipLimits?.[to];
  if (settings.enforceWipLimits && typeof limit === 'number' && limit > 0 && to !== current.columnKey) {
    const count = await prisma.task.count({
      where: { boardId: context.board.id, columnKey: to, isBacklog: false, archivedAt: null },
    });
    if (count >= limit) {
      throw new ConflictError(
        `В колонке «${COLUMN_LABELS[to]}» достигнут лимит задач (${limit}). Сначала завершите начатое.`,
        'WIP_LIMIT_REACHED',
      );
    }
  }
}
