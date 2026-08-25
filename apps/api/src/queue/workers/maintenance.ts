import { Worker, type Job } from 'bullmq';
import { LoginTokenStatus } from '@kaif/shared';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { createRedisConnection } from '../../lib/redis.js';
import { deleteStoredFile } from '../../lib/files.js';
import { QUEUE_NAMES } from '../index.js';

/**
 * Ночное обслуживание: подчищаем мусор и сверяем денормализованные счётчики.
 * Счётчики обновляются в транзакциях, но сверка раз в сутки страхует от
 * расхождений после сбоев и ручных правок в базе.
 */
export function createMaintenanceWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.maintenance,
    async (_job: Job) => {
      await cleanupPendingAttachments();
      await expireLoginTokens();
      await cleanupSessions();
      await cleanupNotifications();
      await reconcileTaskCounters();
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
