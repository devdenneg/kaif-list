import { Worker, type Job } from 'bullmq';
import {
  ActivityType,
  ColumnKey,
  LoginTokenStatus,
  SOCKET_EVENTS,
  mergeBoardSettings,
  rooms,
} from '@kaif/shared';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { createRedisConnection } from '../../lib/redis.js';
import { deleteStoredFile } from '../../lib/files.js';
import { recordActivity } from '../../services/activity.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { syncBlockedByBlocker } from '../../modules/tasks/links.js';
import { QUEUE_NAMES } from '../index.js';

/**
 * Ночное обслуживание: подчищаем мусор и сверяем денормализованные счётчики.
 * Счётчики обновляются в транзакциях, но сверка раз в сутки страхует от
 * расхождений после сбоев и ручных правок в базе.
 */
export function createMaintenanceWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.maintenance,
    async (job: Job) => {
      // Автоархив ходит каждый час, всё остальное — раз в сутки ночью.
      if (job.name === 'auto-archive') {
        await archiveSettledTasks();
        return;
      }

      await cleanupPendingAttachments();
      await expireLoginTokens();
      await cleanupSessions();
      await cleanupNotifications();
      await archiveSettledTasks();
      await reconcileTaskCounters();
      await reconcileOpenTransitions();
    },
    { connection: createRedisConnection('worker-maintenance'), concurrency: 1 },
  ).on('failed', (_job, error) => {
    logger.error({ err: error?.message }, 'Обслуживание не выполнено');
  });
}

/** Файлы, загруженные, но так и не прикреплённые к задаче. */
async function cleanupPendingAttachments(): Promise<void> {
  const orphans = await prisma.attachment.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    select: { id: true, storedName: true, thumbName: true },
    take: 500,
  });
  if (orphans.length === 0) return;

  for (const orphan of orphans) {
    await deleteStoredFile(orphan.storedName, orphan.thumbName);
  }
  await prisma.attachment.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
  logger.info({ count: orphans.length }, 'Удалены неприкреплённые файлы');
}

async function expireLoginTokens(): Promise<void> {
  const result = await prisma.loginToken.updateMany({
    where: { status: LoginTokenStatus.PENDING, expiresAt: { lt: new Date() } },
    data: { status: LoginTokenStatus.EXPIRED },
  });
  await prisma.loginToken.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  if (result.count > 0) logger.debug({ count: result.count }, 'Просроченные коды входа помечены');
}

async function cleanupSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  if (result.count > 0) logger.info({ count: result.count }, 'Старые сессии удалены');
}

async function cleanupNotifications(): Promise<void> {
  const result = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } },
  });
  if (result.count > 0) logger.info({ count: result.count }, 'Старые уведомления удалены');
}

/**
 * Убрать с доски задачи, которые давно закрыты.
 *
 * Отсчёт идёт от попадания в «Готово» — от `completedAt`. Поле обнуляется,
 * как только задачу забрали из «Готово», и проставляется заново при
 * следующем закрытии, поэтому таймер сам собой сбрасывается и начинается
 * с нуля: специально ничего отменять не нужно.
 *
 * Срок настраивается на каждой доске отдельно, ноль означает «не убирать».
 */
async function archiveSettledTasks(): Promise<void> {
  const boards = await prisma.board.findMany({
    where: { isArchived: false },
    select: { id: true, settings: true },
  });

  const now = new Date();
  let archived = 0;

  for (const board of boards) {
    const days = mergeBoardSettings(board.settings).autoArchiveDoneDays;
    if (days <= 0) continue;

    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const tasks = await prisma.task.findMany({
      where: {
        boardId: board.id,
        archivedAt: null,
        columnKey: ColumnKey.DONE,
        completedAt: { lt: cutoff },
      },
      select: { id: true, key: true, title: true },
      take: 500,
    });
    if (tasks.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({
        where: { id: { in: tasks.map((task) => task.id) } },
        data: { archivedAt: now },
      });
      for (const task of tasks) {
        await recordActivity(tx, {
          boardId: board.id,
          taskId: task.id,
          actorId: null,
          type: ActivityType.TASK_ARCHIVED,
          payload: { auto: true, afterDays: days },
        });
      }
    });

    // Архивная задача никого не держит: снимаем блокировки с зависимых.
    for (const task of tasks) {
      await syncBlockedByBlocker(task.id, null);
    }

    await publishRealtime({
      room: rooms.board(board.id),
      event: SOCKET_EVENTS.BOARD_UPDATED,
      data: { boardId: board.id },
    });

    archived += tasks.length;
  }

  if (archived > 0) logger.info({ archived }, 'Закрытые задачи убраны в архив');
}

/**
 * Сверка открытых отрезков в истории колонок.
 *
 * У каждой живой задачи должен быть ровно один незакрытый отрезок — тот,
 * в котором она находится сейчас. Расхождения возможны после сбоя посреди
 * транзакции или ручной правки в базе, и молча они превращаются во враньё
 * в отчётах: время в колонке считается по этим отрезкам.
 *
 * Чиним два случая: лишние открытые отрезки закрываем, полное отсутствие —
 * заводим отрезок с момента последней активности. Задачи, размеченные
 * скриптом разметки, сюда не попадают: у них отрезки уже есть.
 */
async function reconcileOpenTransitions(): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null },
    select: { id: true, boardId: true, columnKey: true, lastActivityAt: true, createdAt: true },
    take: 20_000,
  });
  if (tasks.length === 0) return;

  const open = await prisma.taskColumnTransition.findMany({
    where: { taskId: { in: tasks.map((task) => task.id) }, leftAt: null },
    orderBy: { enteredAt: 'desc' },
    select: { id: true, taskId: true, enteredAt: true, toColumn: true },
  });

  const openByTask = new Map<string, typeof open>();
  for (const row of open) {
    const list = openByTask.get(row.taskId) ?? [];
    list.push(row);
    openByTask.set(row.taskId, list);
  }

  const now = new Date();
  let closed = 0;
  let created = 0;

  for (const task of tasks) {
    const rows = openByTask.get(task.id) ?? [];

    // Лишние открытые отрезки: оставляем самый свежий, остальные закрываем.
    for (const stale of rows.slice(1)) {
      await prisma.taskColumnTransition.update({
        where: { id: stale.id },
        data: {
          leftAt: now,
          durationMinutes: Math.max(
            0,
            Math.round((now.getTime() - stale.enteredAt.getTime()) / 60_000),
          ),
        },
      });
      closed += 1;
    }

    if (rows.length === 0) {
      await prisma.taskColumnTransition.create({
        data: {
          taskId: task.id,
          boardId: task.boardId,
          fromColumn: null,
          toColumn: task.columnKey,
          enteredAt: task.lastActivityAt ?? task.createdAt,
        },
      });
      created += 1;
    }
  }

  if (closed > 0 || created > 0) {
    logger.info({ closed, created }, 'История колонок сверена');
  }
}

/** Сверка счётчиков комментариев, вложений и чек-листов. */
async function reconcileTaskCounters(): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      commentCount: true,
      attachmentCount: true,
      checklistTotal: true,
      checklistDone: true,
    },
    take: 20_000,
  });
  if (tasks.length === 0) return;

  const taskIds = tasks.map((task) => task.id);

  // Считаем агрегатами, а не по одной задаче: четыре запроса вместо тысяч.
  const [comments, attachments, checklists] = await Promise.all([
    prisma.comment.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.attachment.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds }, status: 'ATTACHED' },
      _count: { _all: true },
    }),
    prisma.checklist.findMany({
      where: { taskId: { in: taskIds } },
      select: { id: true, taskId: true },
    }),
  ]);

  const checklistIds = checklists.map((checklist) => checklist.id);
  const [items, doneItems] = await Promise.all([
    checklistIds.length > 0
      ? prisma.checklistItem.groupBy({
          by: ['checklistId'],
          where: { checklistId: { in: checklistIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    checklistIds.length > 0
      ? prisma.checklistItem.groupBy({
          by: ['checklistId'],
          where: { checklistId: { in: checklistIds }, done: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const taskByChecklist = new Map(checklists.map((checklist) => [checklist.id, checklist.taskId]));
  const commentMap = new Map(
    comments.filter((row) => row.taskId).map((row) => [row.taskId as string, row._count._all]),
  );
  const attachmentMap = new Map(
    attachments.filter((row) => row.taskId).map((row) => [row.taskId as string, row._count._all]),
  );

  const totalMap = new Map<string, number>();
  for (const row of items) {
    const taskId = taskByChecklist.get(row.checklistId);
    if (!taskId) continue;
    totalMap.set(taskId, (totalMap.get(taskId) ?? 0) + row._count._all);
  }
  const doneMap = new Map<string, number>();
  for (const row of doneItems) {
    const taskId = taskByChecklist.get(row.checklistId);
    if (!taskId) continue;
    doneMap.set(taskId, (doneMap.get(taskId) ?? 0) + row._count._all);
  }

  let fixed = 0;
  for (const task of tasks) {
    const expected = {
      commentCount: commentMap.get(task.id) ?? 0,
      attachmentCount: attachmentMap.get(task.id) ?? 0,
      checklistTotal: totalMap.get(task.id) ?? 0,
      checklistDone: doneMap.get(task.id) ?? 0,
    };
    if (
      expected.commentCount === task.commentCount &&
      expected.attachmentCount === task.attachmentCount &&
      expected.checklistTotal === task.checklistTotal &&
      expected.checklistDone === task.checklistDone
    ) {
      continue;
    }
    await prisma.task.update({ where: { id: task.id }, data: expected });
    fixed += 1;
  }

  if (fixed > 0) logger.info({ fixed }, 'Счётчики задач синхронизированы');
}
