import {
  ActivityType,
  ColumnKey,
  NotificationType,
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
import { dispatchNotification, taskRecipients } from '../../services/notify.js';
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

  // Какая из двух задач окажется заблокированной этой связью.
  const blockedTaskId =
    input.type === TaskLinkType.BLOCKED_BY
      ? context.task.id
      : input.type === TaskLinkType.BLOCKS
        ? target.id
        : null;

  if (input.type === TaskLinkType.BLOCKED_BY || input.type === TaskLinkType.BLOCKS) {
    await assertNoCycle(context.task.id, target.id, input.type);
  }

  const blockedBefore = blockedTaskId ? await blockedCountOf(blockedTaskId) : 0;

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

  if (blockedTaskId) {
    await notifyBlockChange(blockedTaskId, blockedBefore, user.id);
  }

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

  const blockedTaskId =
    link.type === TaskLinkType.BLOCKED_BY
      ? context.task.id
      : link.type === TaskLinkType.BLOCKS
        ? link.toTaskId
        : null;
  const blockedBefore = blockedTaskId ? await blockedCountOf(blockedTaskId) : 0;

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

  if (blockedTaskId) {
    await notifyBlockChange(blockedTaskId, blockedBefore, user.id);
  }
}

async function blockedCountOf(taskId: string): Promise<number> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { blockedByCount: true },
  });
  return task?.blockedByCount ?? 0;
}

/**
 * Сообщить, что задача заблокировалась или освободилась.
 *
 * Сравниваем счётчик до и после: важен сам переход, а не число блокеров.
 * Убрали один из трёх — человека дёргать незачем, он всё ещё ждёт.
 */
async function notifyBlockChange(
  taskId: string,
  countBefore: number,
  actorId: string | null,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, key: true, title: true, boardId: true, blockedByCount: true },
  });
  if (!task) return;

  const wasBlocked = countBefore > 0;
  const isBlocked = task.blockedByCount > 0;
  if (wasBlocked === isBlocked) return;

  const recipients = await taskRecipients(task.id, { excludeUserId: actorId });
  if (recipients.length === 0) return;

  await dispatchNotification({
    type: isBlocked ? NotificationType.TASK_BLOCKED : NotificationType.TASK_UNBLOCKED,
    recipientIds: recipients,
    actorId,
    boardId: task.boardId,
    taskId: task.id,
    payload: { taskKey: task.key, taskTitle: task.title },
  });
}

/**
 * Пересчитать блокировки у задач, которые ждут эту.
 *
 * Счётчик блокеров считает только незакрытые задачи, поэтому при закрытии,
 * архивации или возврате блокера он у зависимых задач устаревает. Раньше это
 * никто не обновлял: человек закрывал блокер, а его коллега продолжал видеть
 * «заблокирована» и не мог сдвинуть свою задачу с места.
 *
 * Заодно это точка, где рождается самое полезное уведомление в продукте:
 * «твою задачу разблокировали, можно продолжать».
 */
export async function syncBlockedByBlocker(
  blockerTaskId: string,
  actorId: string | null,
): Promise<void> {
  const dependents = await prisma.taskLink.findMany({
    where: { toTaskId: blockerTaskId, type: TaskLinkType.BLOCKED_BY },
    select: { fromTaskId: true },
  });
  if (dependents.length === 0) return;

  const blocker = await prisma.task.findUnique({
    where: { id: blockerTaskId },
    select: { key: true, title: true },
  });

  const before = await prisma.task.findMany({
    where: { id: { in: dependents.map((link) => link.fromTaskId) } },
    select: { id: true, key: true, title: true, boardId: true, blockedByCount: true },
  });

  const changed: { task: (typeof before)[number]; blocked: boolean }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const task of before) {
      await refreshBlockedCount(tx, task.id);
    }
  });

  const after = await prisma.task.findMany({
    where: { id: { in: before.map((task) => task.id) } },
    select: { id: true, blockedByCount: true },
  });
  const countById = new Map(after.map((row) => [row.id, row.blockedByCount]));

  for (const task of before) {
    const next = countById.get(task.id) ?? task.blockedByCount;
    const wasBlocked = task.blockedByCount > 0;
    const isBlocked = next > 0;
    if (wasBlocked !== isBlocked) changed.push({ task, blocked: isBlocked });
  }

  // Экраны обновляем у всех зависимых задач: счётчик мог измениться и там,
  // где состояние «заблокирована/нет» осталось прежним.
  await publishRealtime(
    before.flatMap((task) => [
      {
        room: rooms.task(task.id),
        event: SOCKET_EVENTS.TASK_UPDATED,
        data: { boardId: task.boardId, taskId: task.id, fields: ['links', 'blockedByCount'] },
      },
      {
        room: rooms.board(task.boardId),
        event: SOCKET_EVENTS.TASK_UPDATED,
        data: { boardId: task.boardId, taskId: task.id, fields: ['blockedByCount'] },
      },
    ]),
  );

  for (const { task, blocked } of changed) {
    const recipients = await taskRecipients(task.id, { excludeUserId: actorId });
    if (recipients.length === 0) continue;

    await dispatchNotification({
      type: blocked ? NotificationType.TASK_BLOCKED : NotificationType.TASK_UNBLOCKED,
      recipientIds: recipients,
      actorId,
      boardId: task.boardId,
      taskId: task.id,
      payload: {
        taskKey: task.key,
        taskTitle: task.title,
        blockerKey: blocker?.key ?? '',
      },
    });
  }
}

/** Пересчёт счётчика блокеров у списка задач — без уведомлений. */
export async function refreshBlockedCounts(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const taskId of taskIds) await refreshBlockedCount(tx, taskId);
  });
}

/**
 * Что считается живым блокером.
 *
 * Закрытая или заброшенная в архив задача никого не держит — иначе
 * «разблокировано» не наступало бы никогда, и счётчик на карточке врал бы.
 * Вынесено отдельно, потому что на этом условии держится весь смысл
 * блокировок, а проверить его запросом к базе в тестах негде.
 */
export function activeBlockersWhere(taskId: string): Prisma.TaskLinkWhereInput {
  return {
    fromTaskId: taskId,
    type: TaskLinkType.BLOCKED_BY,
    toTask: { archivedAt: null, columnKey: { not: ColumnKey.DONE } },
  };
}

async function refreshBlockedCount(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  const count = await tx.taskLink.count({ where: activeBlockersWhere(taskId) });
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
