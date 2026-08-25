import {
  COLUMN_LABELS,
  NotificationType,
  PRIORITY_LABELS,
  formatDueRelative,
  type ColumnKey,
  type TaskPriority,
} from '@kaif/shared';

/**
 * Тексты уведомлений собираются в одном месте — и для колокольчика в вебе,
 * и для сообщения в Telegram. Иначе они неизбежно разъезжаются.
 */

export interface NotificationPayload {
  taskKey?: string;
  taskTitle?: string;
  boardName?: string;
  boardKey?: string;
  actorName?: string;
  fromColumn?: ColumnKey;
  toColumn?: ColumnKey;
  reason?: string | null;
  commentPreview?: string;
  dueDate?: string | null;
  previousDueDate?: string | null;
  priority?: TaskPriority;
  role?: string;
  fields?: string[];
  /** Ключ задачи-блокера — в тексте про блокировку и разблокировку. */
  blockerKey?: string;
  digest?: {
    overdue: number;
    today: number;
    inProgress: number;
    items: { key: string; title: string; due: string | null }[];
  };
  message?: string;
  [key: string]: unknown;
}

export interface NotificationText {
  title: string;
  body: string;
  /** Эмодзи-маркер для Telegram и списка уведомлений. */
  icon: string;
}

const column = (key: ColumnKey | undefined): string => (key ? COLUMN_LABELS[key] : '—');

export function buildNotificationText(
  type: NotificationType,
  payload: NotificationPayload,
): NotificationText {
  const actor = payload.actorName ?? 'Кто-то';
  const task = payload.taskTitle ?? 'задача';
  const reason = payload.reason?.trim();

  switch (type) {
    case NotificationType.TASK_ASSIGNED_TO_YOU:
      return {
        icon: '🎯',
        title: 'Задача назначена на вас',
        body: `${actor} назначил(а) вас исполнителем: «${task}»${
          payload.dueDate ? `. Срок ${formatDueRelative(payload.dueDate)}` : ''
        }`,
      };

    case NotificationType.TASK_UNASSIGNED_FROM_YOU:
      return {
        icon: '↩️',
        title: 'Задача снята с вас',
        body: `${actor} снял(а) с вас задачу «${task}»${reason ? `. Причина: ${reason}` : ''}`,
      };

    case NotificationType.TASK_TESTER_ASSIGNED:
      return {
        icon: '🔍',
        title: 'Вы назначены тестировщиком',
        body: `${actor} назначил(а) вас тестировщиком задачи «${task}»`,
      };

    case NotificationType.TASK_STATUS_CHANGED:
      return {
        icon: '➡️',
        title: 'Статус задачи изменён',
        body: `${actor}: «${task}» — ${column(payload.fromColumn)} → ${column(payload.toColumn)}`,
      };

    case NotificationType.TASK_RETURNED:
      return {
        icon: '🔴',
        title: 'Задачу вернули назад',
        body: `${actor} вернул(а) «${task}»: ${column(payload.fromColumn)} → ${column(
          payload.toColumn,
        )}${reason ? `\nПричина: ${reason}` : ''}`,
      };

    case NotificationType.TASK_PUT_ON_HOLD:
      return {
        icon: '⏸️',
        title: 'Задача поставлена на паузу',
        body: `${actor} поставил(а) «${task}» на паузу${reason ? `\nПричина: ${reason}` : ''}`,
      };

    case NotificationType.TASK_DUE_DATE_CHANGED:
      return {
        icon: '📅',
        title: 'Дедлайн изменён',
        body: `${actor} перенёс(ла) срок задачи «${task}»${
          payload.dueDate ? ` на ${formatDate(payload.dueDate)}` : ' (срок снят)'
        }${reason ? `\nПричина: ${reason}` : ''}`,
      };

    case NotificationType.TASK_DUE_SOON:
      return {
        icon: '⏳',
        title: 'Скоро дедлайн',
        body: `«${task}» — срок ${formatDueRelative(payload.dueDate ?? null)}`,
      };

    case NotificationType.TASK_OVERDUE:
      return {
        icon: '🔥',
        title: 'Задача просрочена',
        body: `«${task}» — ${formatDueRelative(payload.dueDate ?? null)}`,
      };

    case NotificationType.TASK_UPDATED:
      return {
        icon: '✏️',
        title: 'Задача обновлена',
        body: `${actor} изменил(а) «${task}»${
          payload.fields?.length ? ` (${payload.fields.join(', ')})` : ''
        }`,
      };

    case NotificationType.TASK_ARCHIVED:
      return {
        icon: '📦',
        title: 'Задача в архиве',
        body: `${actor} отправил(а) «${task}» в архив${reason ? `. Причина: ${reason}` : ''}`,
      };

    case NotificationType.COMMENT_ADDED:
      return {
        icon: '💬',
        title: 'Новый комментарий',
        body: `${actor} в «${task}»: ${payload.commentPreview ?? ''}`.trim(),
      };

    case NotificationType.MENTIONED:
      return {
        icon: '📣',
        title: 'Вас упомянули',
        body: `${actor} упомянул(а) вас в «${task}»: ${payload.commentPreview ?? ''}`.trim(),
      };

    case NotificationType.ATTACHMENT_ADDED:
      return {
        icon: '📎',
        title: 'Новое вложение',
        body: `${actor} приложил(а) файл к задаче «${task}»`,
      };

    case NotificationType.BOARD_INVITED:
      return {
        icon: '👋',
        title: 'Вас добавили на доску',
        body: `${actor} добавил(а) вас на доску «${payload.boardName ?? ''}»${
          payload.role ? ` с ролью «${payload.role}»` : ''
        }`,
      };

    case NotificationType.TASK_UNBLOCKED:
      return {
        icon: '🟢',
        title: 'Задача разблокирована',
        body: payload.blockerKey
          ? `«${task}» больше ничего не держит: ${payload.blockerKey} закрыта. Можно продолжать`
          : `«${task}» больше ничего не держит — можно продолжать`,
      };

    case NotificationType.TASK_BLOCKED:
      return {
        icon: '🔴',
        title: 'Задача заблокирована',
        body: payload.blockerKey
          ? `«${task}» ждёт ${payload.blockerKey}`
          : `«${task}» заблокирована другой задачей`,
      };

    case NotificationType.BOARD_MEMBER_JOINED:
      return {
        icon: '🤝',
        title: 'Новый человек на доске',
        body: `${actor} присоединился(ась) к доске «${payload.boardName ?? ''}» по вашей ссылке`,
      };

    case NotificationType.BOARD_ROLE_CHANGED:
      return {
        icon: '🔑',
        title: 'Роль на доске изменена',
        body: `${actor} изменил(а) вашу роль на доске «${payload.boardName ?? ''}»${
          payload.role ? ` на «${payload.role}»` : ''
        }`,
      };

    case NotificationType.BOARD_REMOVED:
      return {
        icon: '🚪',
        title: 'Доступ к доске закрыт',
        body: `${actor} убрал(а) вас с доски «${payload.boardName ?? ''}»`,
      };

    case NotificationType.DAILY_DIGEST: {
      const digest = payload.digest;
      if (!digest) return { icon: '☀️', title: 'Сводка на сегодня', body: 'Активных задач нет' };
      const lines = [
        digest.overdue > 0 ? `🔥 Просрочено: ${digest.overdue}` : null,
        digest.today > 0 ? `📅 Сегодня: ${digest.today}` : null,
        digest.inProgress > 0 ? `⚙️ В работе: ${digest.inProgress}` : null,
      ].filter(Boolean);
      return {
        icon: '☀️',
        title: 'Сводка на сегодня',
        body: lines.length > 0 ? lines.join('\n') : 'На сегодня ничего не горит',
      };
    }

    case NotificationType.SECURITY_ALERT:
      return {
        icon: '🛡️',
        title: 'Безопасность аккаунта',
        body: payload.message ?? 'Обнаружена подозрительная активность в вашем аккаунте',
      };

    default:
      return { icon: '🔔', title: 'Уведомление', body: payload.message ?? '' };
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

/** Экранирование для parse_mode=HTML в Telegram. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TelegramMessage {
  text: string;
  taskUrl: string | null;
}

/** Финальный текст сообщения в Telegram. */
export function buildTelegramMessage(
  type: NotificationType,
  payload: NotificationPayload,
  appUrl: string,
): TelegramMessage {
  const { title, body, icon } = buildNotificationText(type, payload);
  const lines: string[] = [];

  if (payload.taskKey) {
    lines.push(
      `${icon} <b>${escapeHtml(payload.taskKey)}</b> · ${escapeHtml(payload.taskTitle ?? '')}`,
    );
  } else {
    lines.push(`${icon} <b>${escapeHtml(title)}</b>`);
  }

  lines.push(escapeHtml(body));

  const meta: string[] = [];
  if (payload.boardName) meta.push(`доска «${escapeHtml(payload.boardName)}»`);
  if (payload.priority && payload.priority !== 'MEDIUM') {
    meta.push(`приоритет: ${escapeHtml(PRIORITY_LABELS[payload.priority])}`);
  }
  if (meta.length > 0) lines.push(`<i>${meta.join(' · ')}</i>`);

  const taskUrl = payload.taskKey
    ? `${appUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(payload.taskKey)}`
    : null;

  return { text: lines.filter(Boolean).join('\n'), taskUrl };
}
