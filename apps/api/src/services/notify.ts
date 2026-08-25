import {
  NotificationType,
  SOCKET_EVENTS,
  isNotificationAllowed,
  mergeNotificationPreferences,
  rooms,
  shouldDeliverToTelegram,
} from '@kaif/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { mapNotification, notificationSelect } from '../lib/mappers.js';
import { publishRealtime, type RealtimeEvent } from '../realtime/bridge.js';
import { enqueueSingleNotification, enqueueTaskNotification } from '../queue/index.js';
import type { NotificationPayload } from './notification-text.js';

/**
 * Рассылка уведомлений.
 *
 * Ин-апп уведомления пишутся сразу (это быстро и даёт мгновенный отклик),
 * а доставка в Telegram уходит в очередь — там ретраи, лимиты и склейка
 * нескольких событий по одной задаче в одно сообщение.
 */

export interface DispatchInput {
  type: NotificationType;
  /** Кому: список id пользователей (уже развёрнутый). */
  recipientIds: string[];
  actorId: string | null;
  boardId?: string | null;
  taskId?: string | null;
  payload: NotificationPayload;
  /** Не уведомлять инициатора — включено по умолчанию. */
  excludeActor?: boolean;
}

export async function dispatchNotification(input: DispatchInput): Promise<void> {
  const excludeActor = input.excludeActor ?? true;
  const recipientIds = [...new Set(input.recipientIds)].filter(
    (id) => id && (!excludeActor || id !== input.actorId),
  );
  if (recipientIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: recipientIds }, isActive: true },
    select: {
      id: true,
      timezone: true,
      botChatId: true,
      botBlocked: true,
      notificationPrefs: true,
    },
  });
  if (users.length === 0) return;

  const targets = users
    .map((user) => ({ user, prefs: mergeNotificationPreferences(user.notificationPrefs) }))
    .filter(({ prefs }) => isNotificationAllowed(input.type, prefs));
  if (targets.length === 0) return;

  const now = new Date();

  const created = await prisma.$transaction(
    targets.map(({ user }) =>
      prisma.notification.create({
        data: {
          userId: user.id,
          type: input.type,
          boardId: input.boardId ?? null,
          taskId: input.taskId ?? null,
          actorId: input.actorId,
          payload: input.payload as object,
        },
        select: notificationSelect,
      }),
    ),
  );

  const unreadCounts = await prisma.notification.groupBy({
    by: ['userId'],
    where: { userId: { in: targets.map((t) => t.user.id) }, readAt: null },
    _count: { _all: true },
  });
  const unreadByUser = new Map(unreadCounts.map((row) => [row.userId, row._count._all]));

  const events: RealtimeEvent[] = [];
  for (const notification of created) {
    events.push({
      room: rooms.user(notification.userId ?? ''),
      event: SOCKET_EVENTS.NOTIFICATION_NEW,
      data: mapNotification(notification),
    });
  }
  for (const { user } of targets) {
    events.push({
      room: rooms.user(user.id),
      event: SOCKET_EVENTS.NOTIFICATION_COUNT,
      data: { unread: unreadByUser.get(user.id) ?? 0 },
    });
  }
  await publishRealtime(events);

  await Promise.all(
    targets.map(async ({ user, prefs }, index) => {
      if (!user.botChatId || user.botBlocked) return;
      if (!shouldDeliverToTelegram(input.type, prefs, user.timezone, now)) return;

      const notification = created[index];
      if (!notification) return;

      if (input.taskId) {
        await enqueueTaskNotification(user.id, input.taskId);
      } else {
        await enqueueSingleNotification(user.id, notification.id);
      }
    }),
  ).catch((error) => {
    logger.error({ err: error }, 'Ошибка постановки уведомлений в очередь Telegram');
  });
}

/**
 * Участники задачи, которым положено уведомление.
 * `muted` — человек явно отписался и больше не хочет уведомлений по этой задаче.
 */
export async function taskRecipients(
  taskId: string,
  options: { excludeUserId?: string | null } = {},
): Promise<string[]> {
  const participants = await prisma.taskParticipant.findMany({
    where: { taskId, muted: false },
    select: { userId: true },
    distinct: ['userId'],
  });
  const ids = participants.map((p) => p.userId);
  return options.excludeUserId ? ids.filter((id) => id !== options.excludeUserId) : ids;
}

/** Уведомление о событии безопасности — всегда доставляется. */
export async function notifySecurity(userId: string, message: string): Promise<void> {
  await dispatchNotification({
    type: NotificationType.SECURITY_ALERT,
    recipientIds: [userId],
    actorId: null,
    payload: { message },
    excludeActor: false,
  });
}
