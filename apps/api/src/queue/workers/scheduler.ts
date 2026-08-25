import { Worker, type Job } from 'bullmq';
import {
  ColumnKey,
  NotificationType,
  localMinutesOfDay,
  mergeNotificationPreferences,
} from '@kaif/shared';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { createRedisConnection } from '../../lib/redis.js';
import { dispatchNotification } from '../../services/notify.js';
import {
  QUEUE_NAMES,
  enqueueSingleNotification,
  enqueueTaskNotification,
} from '../index.js';
import { shouldDeliverToTelegram } from '@kaif/shared';

/**
 * Плановые уведомления: напоминания о дедлайнах и утренний дайджест.
 * Запускается каждые 15 минут — окна подобраны так, чтобы каждое событие
 * попадало ровно в один запуск и ничего не дублировалось.
 */

const WINDOW_MS = 15 * 60 * 1000;

export function createSchedulerWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.scheduler,
    async (job: Job) => {
      if (job.name === 'due-reminders') return runDueReminders();
      if (job.name === 'daily-digest') return runDailyDigest();
      if (job.name === 'quiet-hours-flush') return flushQuietHours();
      return undefined;
    },
    { connection: createRedisConnection('worker-scheduler'), concurrency: 1 },
  ).on('failed', (job, error) => {
    logger.error({ jobName: job?.name, err: error?.message }, 'Плановая задача не выполнена');
  });
}

/**
 * Досылка того, что задержали тихие часы.
 *
 * Настройки обещают человеку: «уведомления копятся и приходят потом».
 * Раньше «потом» не наступало никогда — уведомление оставалось в базе
 * с пустым telegramSentAt, и его никто больше не трогал. Теперь каждые
 * 15 минут проверяем, у кого тихие часы закончились, и досылаем.
 *
 * Сюда же попадает всё, что не ушло по другим причинам: очередь была
 * недоступна, Redis перезапускали, воркер падал.
 */
const QUIET_FLUSH_MAX_AGE_MS = 24 * 3_600_000;

async function flushQuietHours(): Promise<void> {
  const now = new Date();

  const pending = await prisma.notification.findMany({
    where: {
      telegramSentAt: null,
      createdAt: { gte: new Date(now.getTime() - QUIET_FLUSH_MAX_AGE_MS) },
      user: { isActive: true, botBlocked: false, botChatId: { not: null } },
    },
    orderBy: { createdAt: 'asc' },
    // Потолок на случай, если что-то массово не отправилось: за один прогон
    // разгребаем ограниченную порцию, остальное уедет через 15 минут.
    take: 500,
    select: {
      id: true,
      type: true,
      userId: true,
      taskId: true,
      user: { select: { timezone: true, notificationPrefs: true } },
    },
  });
  if (pending.length === 0) return;

  // Одна джоба на пару «человек + задача»: воркер всё равно соберёт
  // накопившееся по задаче в одно сообщение.
  const seen = new Set<string>();
  let enqueued = 0;

  for (const notification of pending) {
    const prefs = mergeNotificationPreferences(notification.user.notificationPrefs);
    // Тихие часы ещё идут — или человек отключил этот тип совсем.
    if (!shouldDeliverToTelegram(notification.type, prefs, notification.user.timezone, now)) {
      continue;
    }

    const key = notification.taskId
      ? `${notification.userId}:${notification.taskId}`
      : `one:${notification.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (notification.taskId) {
      await enqueueTaskNotification(notification.userId, notification.taskId);
    } else {
      await enqueueSingleNotification(notification.userId, notification.id);
    }
    enqueued += 1;
  }

  if (enqueued > 0) {
    logger.info({ enqueued, pending: pending.length }, 'Досланы отложенные уведомления');
  }
}

/** Напоминания за 24 часа, за 2 часа и в момент просрочки. */
async function runDueReminders(): Promise<void> {
  const now = Date.now();

  const windows: { type: NotificationType; from: Date; to: Date; label: string }[] = [
    {
      type: NotificationType.TASK_DUE_SOON,
      from: new Date(now + 24 * 3_600_000 - WINDOW_MS),
      to: new Date(now + 24 * 3_600_000),
      label: '24h',
    },
    {
      type: NotificationType.TASK_DUE_SOON,
      from: new Date(now + 2 * 3_600_000 - WINDOW_MS),
      to: new Date(now + 2 * 3_600_000),
      label: '2h',
    },
    {
      type: NotificationType.TASK_OVERDUE,
      from: new Date(now - WINDOW_MS),
      to: new Date(now),
      label: 'overdue',
    },
  ];

  for (const window of windows) {
    const tasks = await prisma.task.findMany({
      where: {
        archivedAt: null,
        isBacklog: false,
        columnKey: { not: ColumnKey.DONE },
        dueDate: { gte: window.from, lt: window.to },
      },
      select: {
        id: true,
        key: true,
        title: true,
        dueDate: true,
        priority: true,
        assigneeId: true,
        reporterId: true,
        board: { select: { id: true, name: true } },
      },
      take: 500,
    });

    for (const task of tasks) {
      const recipients = new Set<string>();
      if (task.assigneeId) recipients.add(task.assigneeId);
      // Просрочку видит и автор — ему нужно решать, что делать.
      if (window.type === NotificationType.TASK_OVERDUE) recipients.add(task.reporterId);
      if (recipients.size === 0) continue;

      const allowed = await filterByReminderPrefs([...recipients]);
      if (allowed.length === 0) continue;

      // Защита от повторов: одно напоминание каждого вида на задачу в сутки.
      const alreadySent = await prisma.notification.findFirst({
        where: {
          taskId: task.id,
          type: window.type,
          createdAt: { gte: new Date(now - 23 * 3_600_000) },
          payload: { path: ['window'], equals: window.label },
        },
        select: { id: true },
      });
      if (alreadySent) continue;

      await dispatchNotification({
        type: window.type,
        recipientIds: allowed,
        actorId: null,
        boardId: task.board.id,
        taskId: task.id,
        excludeActor: false,
        payload: {
          taskKey: task.key,
          taskTitle: task.title,
          boardName: task.board.name,
          dueDate: task.dueDate?.toISOString() ?? null,
          priority: task.priority,
          window: window.label,
        },
      });
    }
  }
}

async function filterByReminderPrefs(userIds: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true, notificationPrefs: true },
  });
  return users
    .filter((user) => mergeNotificationPreferences(user.notificationPrefs).dueReminders)
    .map((user) => user.id);
}

/** Утренняя сводка «что горит» — в личное время каждого пользователя. */
async function runDailyDigest(): Promise<void> {
  const now = new Date();

  const users = await prisma.user.findMany({
    where: { isActive: true, botChatId: { not: null }, botBlocked: false },
    select: { id: true, timezone: true, notificationPrefs: true },
    take: 2000,
  });

  for (const user of users) {
    const prefs = mergeNotificationPreferences(user.notificationPrefs);
    if (!prefs.digestEnabled) continue;

    const [hours, minutes] = prefs.digestTime.split(':').map(Number);
    const target = (hours ?? 9) * 60 + (minutes ?? 0);
    const local = localMinutesOfDay(now, user.timezone);
    // Попадаем ровно в одно 15-минутное окно за сутки.
    if (local < target || local >= target + 15) continue;

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const [overdue, today, inProgress, items] = await Promise.all([
      prisma.task.count({
        where: {
          assigneeId: user.id,
          archivedAt: null,
          columnKey: { not: ColumnKey.DONE },
          dueDate: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          assigneeId: user.id,
          archivedAt: null,
          columnKey: { not: ColumnKey.DONE },
          dueDate: { gte: startOfDay, lt: endOfDay },
        },
      }),
      prisma.task.count({
        where: { assigneeId: user.id, archivedAt: null, columnKey: ColumnKey.IN_PROGRESS },
      }),
      prisma.task.findMany({
        where: {
          assigneeId: user.id,
          archivedAt: null,
          columnKey: { not: ColumnKey.DONE },
          dueDate: { lt: endOfDay },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
        select: { key: true, title: true, dueDate: true },
      }),
    ]);

    // Не будим человека ради пустой сводки.
    if (overdue === 0 && today === 0 && inProgress === 0) continue;

    await dispatchNotification({
      type: NotificationType.DAILY_DIGEST,
      recipientIds: [user.id],
      actorId: null,
      excludeActor: false,
      payload: {
        digest: {
          overdue,
          today,
          inProgress,
          items: items.map((item) => ({
            key: item.key,
            title: item.title,
            due: item.dueDate?.toISOString() ?? null,
          })),
        },
      },
    });
  }
}
