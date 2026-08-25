import { DEFAULT_TIMEZONE } from './constants.js';

/** Состояние дедлайна — определяет подсветку карточки. */
export type DueState = 'none' | 'done' | 'overdue' | 'today' | 'soon' | 'upcoming' | 'normal';

export const DUE_STATE_LABELS: Record<DueState, string> = {
  none: 'Без срока',
  done: 'Завершено',
  overdue: 'Просрочено',
  today: 'Сегодня',
  soon: 'Меньше суток',
  upcoming: 'Скоро',
  normal: 'В графике',
};

/** Приоритет состояния для сортировки «что горит». */
export const DUE_STATE_SEVERITY: Record<DueState, number> = {
  overdue: 5,
  today: 4,
  soon: 3,
  upcoming: 2,
  normal: 1,
  none: 0,
  done: -1,
};

export const DUE_THRESHOLDS = {
  soonHours: 24,
  upcomingDays: 3,
} as const;

/** YYYY-MM-DD в заданной таймзоне — чтобы «сегодня» считалось по часам пользователя. */
export function dateKeyInTimeZone(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export interface DueStateOptions {
  now?: Date;
  /** Задача завершена — подсветка гасится. */
  completed?: boolean;
  timeZone?: string;
}

export function getDueState(
  dueDate: Date | string | null | undefined,
  options: DueStateOptions = {},
): DueState {
  const { now = new Date(), completed = false, timeZone = DEFAULT_TIMEZONE } = options;
  if (completed) return 'done';
  if (!dueDate) return 'none';

  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 'none';

  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';

  if (dateKeyInTimeZone(due, timeZone) === dateKeyInTimeZone(now, timeZone)) return 'today';

  const diffHours = diffMs / 3_600_000;
  if (diffHours <= DUE_THRESHOLDS.soonHours) return 'soon';
  if (diffHours <= DUE_THRESHOLDS.upcomingDays * 24) return 'upcoming';
  return 'normal';
}

/** Человекочитаемая относительная подпись: «через 3 ч», «просрочено на 2 дня». */
export function formatDueRelative(
  dueDate: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!dueDate) return '';
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return '';

  const diffMs = due.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  let value: string;
  if (minutes < 60) value = `${minutes} мин`;
  else if (hours < 24) value = `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  else if (days < 30) value = `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  else {
    const months = Math.round(days / 30);
    value = `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`;
  }

  return overdue ? `просрочено на ${value}` : `через ${value}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
