import { Worker, type Job } from 'bullmq';
import { NotificationType, mergeNotificationPreferences, shouldDeliverToTelegram } from '@kaif/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { createRedisConnection } from '../../lib/redis.js';
import {
  buildTelegramMessage,
  escapeHtml,
  type NotificationPayload,
} from '../../services/notification-text.js';
import { sendTelegramMessage, throttle } from '../../services/telegram-sender.js';
import { QUEUE_NAMES, type TelegramJob } from '../index.js';

/**
 * Доставка уведомлений в Telegram.
 *
 * Ключевая деталь — склейка: джоба по паре (пользователь, задача) стоит
 * в очереди с небольшой задержкой, и за это время все накопившиеся события
 * по задаче собираются в одно сообщение. Иначе при активном обсуждении
 * бот превращается в спамера, и его выключают.
 */
export function createTelegramWorker(): Worker<TelegramJob> {
  return new Worker<TelegramJob>(
    QUEUE_NAMES.telegram,
    async (job: Job<TelegramJob>) => {
      const data = job.data;

      if (data.kind === 'raw') {
        await throttle();
        const result = await sendTelegramMessage({ chatId: data.chatId, text: data.text, taskUrl: data.taskUrl ?? null });
        if (!result.ok && result.retryAfter) throw new Error(`RETRY_AFTER_${result.retryAfter}`);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: {
          id: true,
          botChatId: true,
          botBlocked: true,
          timezone: true,
          isActive: true,
          notificationPrefs: true,
        },
      });
      if (!user?.botChatId || user.botBlocked || !user.isActive) return;

      const prefs = mergeNotificationPreferences(user.notificationPrefs);

      const notifications = await prisma.notification.findMany({
        where: {
          userId: data.userId,
          telegramSentAt: null,
          ...(data.kind === 'task-notifications'
            ? { taskId: data.taskId }
            : { id: data.notificationId }),
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: {
          id: true,
          type: true,
          payload: true,
          createdAt: true,
          taskId: true,
        },
      });
      if (notifications.length === 0) return;

      // Уважаем тихие часы: обычные уведомления подождут до утра,
      // упоминания и безопасность проходят всегда.
      const deliverable = notifications.filter((notification) =>
        shouldDeliverToTelegram(notification.type, prefs, user.timezone, new Date()),
      );
      if (deliverable.length === 0) return;

      const primary = pickPrimary(deliverable);
      const payload = (primary.payload as NotificationPayload) ?? {};
      const message = buildTelegramMessage(primary.type, payload, env.APP_URL);

      let text = message.text;
      const rest = deliverable.filter((n) => n.id !== primary.id);
      if (rest.length > 0) {
        const extras = rest.slice(0, 4).map((notification) => {
          const extra = buildTelegramMessage(
            notification.type,
            (notification.payload as NotificationPayload) ?? {},
            env.APP_URL,
          );
          // Во второстепенных берём только вторую строку — суть события.
          return `• ${escapeHtml(stripTags(extra.text.split('\n')[1] ?? ''))}`;
        });
        text += `\n\n<b>Ещё по этой задаче:</b>\n${extras.join('\n')}`;
        if (rest.length > 4) text += `\n• …и ещё ${rest.length - 4}`;
      }

      const actions = buildActions(primary.type, primary.taskId);

      await throttle();
      const result = await sendTelegramMessage({
        chatId: user.botChatId,
        text,
        taskUrl: message.taskUrl,
        actions,
      });

      if (result.blocked) return;
      if (!result.ok) {
        throw new Error(result.retryAfter ? `RETRY_AFTER_${result.retryAfter}` : 'SEND_FAILED');
      }

      await prisma.notification.updateMany({
        where: { id: { in: deliverable.map((n) => n.id) } },
        data: { telegramSentAt: new Date(), telegramMessageId: result.messageId ?? null },
      });
    },
    {
      connection: createRedisConnection('worker-telegram'),
      concurrency: 5,
      limiter: { max: 25, duration: 1000 },
    },
  ).on('failed', (job, error) => {
    logger.warn({ jobId: job?.id, err: error?.message }, 'Джоба Telegram не выполнена');
  });
}

/** Самое «громкое» событие становится заголовком сообщения. */
const PRIORITY: Record<string, number> = {
  [NotificationType.MENTIONED]: 100,
  [NotificationType.TASK_RETURNED]: 90,
  [NotificationType.TASK_PUT_ON_HOLD]: 85,
  [NotificationType.TASK_ASSIGNED_TO_YOU]: 80,
  [NotificationType.TASK_OVERDUE]: 78,
  [NotificationType.TASK_DUE_SOON]: 75,
  [NotificationType.TASK_DUE_DATE_CHANGED]: 70,
  [NotificationType.TASK_TESTER_ASSIGNED]: 65,
  [NotificationType.COMMENT_ADDED]: 60,
  [NotificationType.TASK_STATUS_CHANGED]: 55,
  [NotificationType.ATTACHMENT_ADDED]: 40,
  [NotificationType.TASK_UPDATED]: 30,
};

function pickPrimary<T extends { type: string }>(items: T[]): T {
  return items.reduce((best, current) =>
    (PRIORITY[current.type] ?? 0) > (PRIORITY[best.type] ?? 0) ? current : best,
  );
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

/** Кнопки быстрых действий прямо в уведомлении. */
function buildActions(
  type: string,
  taskId: string | null,
): { text: string; data: string }[] | undefined {
  if (!taskId) return undefined;

  switch (type) {
    case NotificationType.TASK_ASSIGNED_TO_YOU:
      return [
        { text: '▶️ В работу', data: `mv:${taskId}:IN_PROGRESS` },
        { text: '💬 Ответить', data: `rp:${taskId}` },
      ];
    case NotificationType.TASK_RETURNED:
    case NotificationType.TASK_PUT_ON_HOLD:
      return [
        { text: '▶️ В работу', data: `mv:${taskId}:IN_PROGRESS` },
        { text: '💬 Ответить', data: `rp:${taskId}` },
      ];
    case NotificationType.COMMENT_ADDED:
    case NotificationType.MENTIONED:
      return [{ text: '💬 Ответить', data: `rp:${taskId}` }];
    case NotificationType.TASK_TESTER_ASSIGNED:
      return [
        { text: '✅ Принято', data: `mv:${taskId}:READY_TO_RELEASE` },
        { text: '💬 Ответить', data: `rp:${taskId}` },
      ];
    default:
      return [{ text: '💬 Ответить', data: `rp:${taskId}` }];
  }
}
