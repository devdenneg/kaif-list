import { ActivityType, SOCKET_EVENTS, rankAfter, rankBetween, rooms } from '@kaif/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { sanitizePlainText } from '../../lib/sanitize.js';
import { assertCanTask, type RequestUser, type TaskContext } from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { ensureContributor } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';

/** Чек-листы = подзадачи. Счётчики на задаче пересчитываются в той же транзакции. */

async function refreshChecklistCounters(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  const [total, done] = await Promise.all([
    tx.checklistItem.count({ where: { checklist: { taskId } } }),
    tx.checklistItem.count({ where: { checklist: { taskId }, done: true } }),
  ]);
  await tx.task.update({
    where: { id: taskId },
    data: { checklistTotal: total, checklistDone: done, lastActivityAt: new Date() },
  });
}

async function notifyChanged(context: TaskContext, actorId: string): Promise<void> {
  await publishRealtime([
    {
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId, fields: ['checklists'] },
    },
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId, fields: ['checklists'] },
    },
  ]);
}

export async function createChecklist(
  user: RequestUser,
  context: TaskContext,
  title: string,
): Promise<string> {
  assertCanTask(user, context, 'task.checklist.manage');

  const id = await prisma.$transaction(async (tx) => {
    const last = await tx.checklist.findFirst({
      where: { taskId: context.task.id },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    const created = await tx.checklist.create({
      data: {
        taskId: context.task.id,
        title: sanitizePlainText(title, 120),
        rank: rankAfter(last?.rank ?? null),
      },
      select: { id: true },
    });
    await ensureContributor(tx, context.task.id, user.id);
    return created.id;
  });

  await notifyChanged(context, user.id);
  return id;
}

export async function deleteChecklist(
  user: RequestUser,
  context: TaskContext,
  checklistId: string,
): Promise<void> {
  assertCanTask(user, context, 'task.checklist.manage');

  await prisma.$transaction(async (tx) => {
    const checklist = await tx.checklist.findFirst({
      where: { id: checklistId, taskId: context.task.id },
      select: { id: true },
    });
    if (!checklist) throw new NotFoundError('Чек-лист не найден');
    await tx.checklist.delete({ where: { id: checklistId } });
    await refreshChecklistCounters(tx, context.task.id);
  });

  await notifyChanged(context, user.id);
}

export async function addChecklistItem(
  user: RequestUser,
  context: TaskContext,
  checklistId: string,
  input: { text: string; done?: boolean; assigneeId?: string | null; dueDate?: Date | null },
): Promise<string> {
  assertCanTask(user, context, 'task.checklist.manage');

  const id = await prisma.$transaction(async (tx) => {
    const checklist = await tx.checklist.findFirst({
      where: { id: checklistId, taskId: context.task.id },
      select: { id: true },
    });
    if (!checklist) throw new NotFoundError('Чек-лист не найден');

    const last = await tx.checklistItem.findFirst({
      where: { checklistId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });

    const created = await tx.checklistItem.create({
      data: {
        checklistId,
        text: sanitizePlainText(input.text, 300),
        done: input.done ?? false,
        rank: rankAfter(last?.rank ?? null),
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        completedAt: input.done ? new Date() : null,
      },
      select: { id: true },
    });

    await refreshChecklistCounters(tx, context.task.id);
    await ensureContributor(tx, context.task.id, user.id);
    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.CHECKLIST_UPDATED,
      payload: { action: 'item-added' },
    });
    return created.id;
  });

  await notifyChanged(context, user.id);
  return id;
}

export async function updateChecklistItem(
  user: RequestUser,
  context: TaskContext,
  itemId: string,
  input: {
    text?: string;
    done?: boolean;
    assigneeId?: string | null;
    dueDate?: Date | null;
    beforeItemId?: string | null;
  },
): Promise<void> {
  assertCanTask(user, context, 'task.checklist.manage');

  await prisma.$transaction(async (tx) => {
    const item = await tx.checklistItem.findFirst({
      where: { id: itemId, checklist: { taskId: context.task.id } },
      select: { id: true, checklistId: true, done: true },
    });
    if (!item) throw new NotFoundError('Пункт чек-листа не найден');

    let rank: string | undefined;
    if (input.beforeItemId !== undefined) {
      rank = await rankForItem(tx, item.checklistId, itemId, input.beforeItemId);
    }

    await tx.checklistItem.update({
      where: { id: itemId },
      data: {
        ...(input.text !== undefined ? { text: sanitizePlainText(input.text, 300) } : {}),
        ...(input.done !== undefined
          ? { done: input.done, completedAt: input.done ? new Date() : null }
          : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(rank ? { rank } : {}),
      },
    });

    if (input.done !== undefined && input.done !== item.done) {
      await refreshChecklistCounters(tx, context.task.id);
    }
    await ensureContributor(tx, context.task.id, user.id);
  });

  await notifyChanged(context, user.id);
}

async function rankForItem(
  tx: Prisma.TransactionClient,
  checklistId: string,
  itemId: string,
  beforeItemId: string | null,
): Promise<string> {
  if (!beforeItemId) {
    const last = await tx.checklistItem.findFirst({
      where: { checklistId, id: { not: itemId } },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    return rankAfter(last?.rank ?? null);
  }

  const before = await tx.checklistItem.findFirst({
    where: { id: beforeItemId, checklistId },
    select: { rank: true },
  });
  if (!before) throw new BadRequestError('Некорректная позиция');

  const previous = await tx.checklistItem.findFirst({
    where: { checklistId, id: { not: itemId }, rank: { lt: before.rank } },
    orderBy: { rank: 'desc' },
    select: { rank: true },
  });

  try {
    return rankBetween(previous?.rank ?? null, before.rank);
  } catch {
    return rankAfter(before.rank);
  }
}

export async function deleteChecklistItem(
  user: RequestUser,
  context: TaskContext,
  itemId: string,
): Promise<void> {
  assertCanTask(user, context, 'task.checklist.manage');

  await prisma.$transaction(async (tx) => {
    const item = await tx.checklistItem.findFirst({
      where: { id: itemId, checklist: { taskId: context.task.id } },
      select: { id: true },
    });
    if (!item) throw new NotFoundError('Пункт чек-листа не найден');
    await tx.checklistItem.delete({ where: { id: itemId } });
    await refreshChecklistCounters(tx, context.task.id);
  });

  await notifyChanged(context, user.id);
}
