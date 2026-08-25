import { NotificationType, UNMUTABLE_NOTIFICATIONS } from './enums.js';
import { DEFAULT_TIMEZONE } from './constants.js';

/** Пользовательские настройки уведомлений (хранятся в `User.notificationPrefs`). */
export interface NotificationPreferences {
  /** Присылать уведомления в Telegram. */
  telegramEnabled: boolean;
  /** Утренний дайджест «что на сегодня». */
  digestEnabled: boolean;
  /** Время дайджеста, HH:MM в таймзоне пользователя. */
  digestTime: string;
  /** Напоминания за 24 ч и за 2 ч до дедлайна. */
  dueReminders: boolean;
  /** Тихие часы: уведомления копятся и приходят потом (кроме упоминаний и безопасности). */
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Явно отключённые типы уведомлений. */
  disabledTypes: NotificationType[];
  /** Присылать только то, что касается лично (назначения и упоминания). */
  onlyMine: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  telegramEnabled: true,
  digestEnabled: true,
  digestTime: '09:00',
  dueReminders: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '09:00',
  disabledTypes: [],
  onlyMine: false,
};

export function mergeNotificationPreferences(raw: unknown): NotificationPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const input = raw as Partial<NotificationPreferences>;
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...input,
    disabledTypes: Array.isArray(input.disabledTypes) ? input.disabledTypes : [],
  };
}

/** Личные уведомления, которые проходят даже при `onlyMine`. */
const PERSONAL_TYPES: readonly NotificationType[] = [
  NotificationType.MENTIONED,
  NotificationType.TASK_ASSIGNED_TO_YOU,
  NotificationType.TASK_UNASSIGNED_FROM_YOU,
  NotificationType.TASK_TESTER_ASSIGNED,
  NotificationType.TASK_DUE_SOON,
  NotificationType.TASK_OVERDUE,
  NotificationType.SECURITY_ALERT,
  NotificationType.BOARD_INVITED,
  NotificationType.BOARD_MEMBER_JOINED,
  // Блокировки — про твою собственную работу: «можно продолжать» должно
  // доходить даже до тех, кто оставил только личные уведомления.
  NotificationType.TASK_BLOCKED,
  NotificationType.TASK_UNBLOCKED,
];

/** Пропускать ли уведомление данного типа согласно настройкам. */
export function isNotificationAllowed(
  type: NotificationType,
  prefs: NotificationPreferences,
): boolean {
  if (UNMUTABLE_NOTIFICATIONS.includes(type)) return true;
  if (prefs.disabledTypes.includes(type)) return false;
  if (prefs.onlyMine && !PERSONAL_TYPES.includes(type)) return false;
  return true;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(value: string, fallback: number): number {
  const match = HHMM.exec(value);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Текущее время суток пользователя в минутах от полуночи. */
export function localMinutesOfDay(now: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Сейчас тихие часы у пользователя? Упоминания и безопасность игнорируют это. */
export function isQuietHours(
  prefs: NotificationPreferences,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const current = localMinutesOfDay(now, timeZone);
  const start = minutesOfDay(prefs.quietHoursStart, 22 * 60);
  const end = minutesOfDay(prefs.quietHoursEnd, 9 * 60);
  if (start === end) return false;
  // Интервал через полночь (22:00 → 09:00)
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Уведомление должно уйти в Telegram прямо сейчас? */
export function shouldDeliverToTelegram(
  type: NotificationType,
  prefs: NotificationPreferences,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!prefs.telegramEnabled) return false;
  if (!isNotificationAllowed(type, prefs)) return false;
  if (UNMUTABLE_NOTIFICATIONS.includes(type)) return true;
  return !isQuietHours(prefs, timeZone, now);
}
