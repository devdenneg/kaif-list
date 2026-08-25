import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Очереди BullMQ. Всё, что может быть медленным или упасть (Telegram, картинки,
 * рассылки), выносится из HTTP-запроса сюда — с ретраями и backoff.
 */

export const QUEUE_NAMES = {
  telegram: 'telegram-delivery',
  scheduler: 'scheduler',
  maintenance: 'maintenance',
} as const;

export const queueConnection = createRedisConnection('bullmq');

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: { count: 500, age: 3600 },
  removeOnFail: { count: 1000, age: 24 * 3600 },
};

export const telegramQueue = new Queue(QUEUE_NAMES.telegram, {
  connection: queueConnection,
  defaultJobOptions,
});

export const schedulerQueue = new Queue(QUEUE_NAMES.scheduler, {
  connection: queueConnection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 3 },
});

export const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, {
  connection: queueConnection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
});

export type TelegramJob =
  | {
      kind: 'task-notifications';
      userId: string;
      taskId: string;
    }
  | {
      kind: 'single-notification';
      userId: string;
      notificationId: string;
    }
  | {
      kind: 'raw';
      chatId: string;
      text: string;
      taskUrl?: string | null;
    };

/**
 * Уведомления по одной задаче склеиваются: задаём общий jobId и небольшую
 * задержку. Пока джоба ждёт, новые события по этой же задаче добавляются
 * в БД и уйдут одним сообщением — бот не превращается в спамера.
 */
export const TELEGRAM_BATCH_DELAY_MS = 12_000;

/**
 * Окно склейки в идентификаторе джобы.
 *
 * BullMQ отказывается принимать джобу с идентификатором, который уже лежит
 * в очереди — в том числе среди выполненных и упавших. Выполненные живут час,
 * упавшие сутки, так что постоянный `tg:<user>:<task>` глушил все последующие
 * уведомления по той же задаче: в вебе они появлялись, в Telegram — нет.
 * Номер окна делает идентификатор уникальным для каждого интервала склейки,
 * а лишняя джоба безвредна — воркер просто не найдёт неотправленного.
 *
 * Отделяется подчёркиванием, а не двоеточием: BullMQ разрешает двоеточие
 * в идентификаторе только если частей ровно три — иначе `Custom Id cannot
 * contain :` и уведомление не уходит вообще.
 */
function batchWindow(): number {
  return Math.floor(Date.now() / TELEGRAM_BATCH_DELAY_MS);
}

/** Идентификатор джобы склейки по паре «человек + задача». */
export function taskNotificationJobId(userId: string, taskId: string, window: number): string {
  return `tg:${userId}:${taskId}_${window}`;
}

/** Идентификатор джобы одиночного уведомления. */
export function singleNotificationJobId(notificationId: string, window: number): string {
  return `tg:one:${notificationId}_${window}`;
}

export async function enqueueTaskNotification(userId: string, taskId: string): Promise<void> {
  try {
    await telegramQueue.add(
      'task-notifications',
      { kind: 'task-notifications', userId, taskId } satisfies TelegramJob,
      {
        jobId: taskNotificationJobId(userId, taskId, batchWindow()),
        delay: TELEGRAM_BATCH_DELAY_MS,
        removeOnComplete: true,
      },
    );
  } catch (error) {
    logger.error({ err: error, userId, taskId }, 'Не удалось поставить задачу отправки в очередь');
  }
}

export async function enqueueSingleNotification(
  userId: string,
  notificationId: string,
): Promise<void> {
  try {
    await telegramQueue.add(
      'single-notification',
      { kind: 'single-notification', userId, notificationId } satisfies TelegramJob,
      { jobId: singleNotificationJobId(notificationId, batchWindow()), removeOnComplete: true },
    );
  } catch (error) {
    logger.error({ err: error, notificationId }, 'Не удалось поставить уведомление в очередь');
  }
}

export async function enqueueRawMessage(
  chatId: string,
  text: string,
  taskUrl?: string | null,
): Promise<void> {
  await telegramQueue.add('raw', { kind: 'raw', chatId, text, taskUrl } satisfies TelegramJob);
}

/** Повторяющиеся задания: напоминания о дедлайнах, дайджест, обслуживание. */
export async function registerRepeatableJobs(): Promise<void> {
  await schedulerQueue.add(
    'due-reminders',
    {},
    { repeat: { pattern: '*/15 * * * *' }, jobId: 'due-reminders' },
  );
  await schedulerQueue.add(
    'daily-digest',
    {},
    { repeat: { pattern: '*/15 * * * *' }, jobId: 'daily-digest' },
  );
  await schedulerQueue.add(
    'quiet-hours-flush',
    {},
    { repeat: { pattern: '*/15 * * * *' }, jobId: 'quiet-hours-flush' },
  );
  await maintenanceQueue.add(
    'cleanup',
    {},
    { repeat: { pattern: '17 3 * * *' }, jobId: 'nightly-cleanup' },
  );
  logger.info('Периодические задания зарегистрированы');
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([telegramQueue.close(), schedulerQueue.close(), maintenanceQueue.close()]);
  await queueConnection.quit().catch(() => queueConnection.disconnect());
}
