/**
 * Перечисления домена. Значения совпадают один-в-один с enum'ами Prisma —
 * это единственный источник правды и для API, и для фронта.
 */

export const GlobalRole = {
  SUPERADMIN: 'SUPERADMIN',
  USER: 'USER',
} as const;
export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];

export const BoardRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;
export type BoardRole = (typeof BoardRole)[keyof typeof BoardRole];

/** Вес роли — чем больше, тем шире полномочия. Нужен для сравнения «не выше себя». */
export const BOARD_ROLE_WEIGHT: Record<BoardRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  MEMBER: 'Участник',
  VIEWER: 'Наблюдатель',
};

/** Фиксированный набор колонок — одинаков для всех досок (требование ТЗ). */
export const ColumnKey = {
  TODO: 'TODO',
  ON_HOLD: 'ON_HOLD',
  IN_PROGRESS: 'IN_PROGRESS',
  QA: 'QA',
  READY_TO_RELEASE: 'READY_TO_RELEASE',
  DONE: 'DONE',
} as const;
export type ColumnKey = (typeof ColumnKey)[keyof typeof ColumnKey];

/** Порядок отображения колонок слева направо. */
export const COLUMN_ORDER: readonly ColumnKey[] = [
  ColumnKey.TODO,
  ColumnKey.ON_HOLD,
  ColumnKey.IN_PROGRESS,
  ColumnKey.QA,
  ColumnKey.READY_TO_RELEASE,
  ColumnKey.DONE,
];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  TODO: 'К выполнению',
  ON_HOLD: 'На паузе',
  IN_PROGRESS: 'В работе',
  QA: 'Тестирование',
  READY_TO_RELEASE: 'Готово к релизу',
  DONE: 'Завершено',
};

export const COLUMN_SHORT_LABELS: Record<ColumnKey, string> = {
  TODO: 'Todo',
  ON_HOLD: 'On hold',
  IN_PROGRESS: 'In progress',
  QA: 'QA',
  READY_TO_RELEASE: 'Ready',
  DONE: 'Done',
};

/**
 * Позиция колонки в производственном конвейере.
 * ON_HOLD — «пауза», она вне линейного прогресса, поэтому имеет тот же вес,
 * что и TODO: любой переход в неё считается остановкой и требует объяснения.
 */
export const COLUMN_PIPELINE_RANK: Record<ColumnKey, number> = {
  TODO: 0,
  ON_HOLD: 0,
  IN_PROGRESS: 1,
  QA: 2,
  READY_TO_RELEASE: 3,
  DONE: 4,
};

/** Колонки, попадание в которые означает, что работа над задачей завершена. */
export const TERMINAL_COLUMNS: readonly ColumnKey[] = [ColumnKey.DONE];

export const TaskType = {
  TASK: 'TASK',
  BUG: 'BUG',
  STORY: 'STORY',
  EPIC: 'EPIC',
  CHORE: 'CHORE',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  STORY: 'История',
  EPIC: 'Эпик',
  CHORE: 'Рутина',
};

export const TaskPriority = {
  LOWEST: 'LOWEST',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
  BLOCKER: 'BLOCKER',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  LOWEST: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
  BLOCKER: 5,
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOWEST: 'Минимальный',
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
  BLOCKER: 'Блокер',
};

export const ParticipantRole = {
  REPORTER: 'REPORTER',
  ASSIGNEE: 'ASSIGNEE',
  TESTER: 'TESTER',
  WATCHER: 'WATCHER',
  CONTRIBUTOR: 'CONTRIBUTOR',
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];

export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  REPORTER: 'Автор',
  ASSIGNEE: 'Исполнитель',
  TESTER: 'Тестировщик',
  WATCHER: 'Наблюдатель',
  CONTRIBUTOR: 'Контрибьютор',
};

export const TaskLinkType = {
  BLOCKS: 'BLOCKS',
  BLOCKED_BY: 'BLOCKED_BY',
  RELATES: 'RELATES',
  DUPLICATES: 'DUPLICATES',
  DUPLICATED_BY: 'DUPLICATED_BY',
} as const;
export type TaskLinkType = (typeof TaskLinkType)[keyof typeof TaskLinkType];

export const TASK_LINK_LABELS: Record<TaskLinkType, string> = {
  BLOCKS: 'Блокирует',
  BLOCKED_BY: 'Заблокирована',
  RELATES: 'Связана с',
  DUPLICATES: 'Дублирует',
  DUPLICATED_BY: 'Дублируется',
};

/** Обратная связь для двусторонних ссылок между задачами. */
export const TASK_LINK_INVERSE: Record<TaskLinkType, TaskLinkType> = {
  BLOCKS: 'BLOCKED_BY',
  BLOCKED_BY: 'BLOCKS',
  RELATES: 'RELATES',
  DUPLICATES: 'DUPLICATED_BY',
  DUPLICATED_BY: 'DUPLICATES',
};

export const CommentKind = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type CommentKind = (typeof CommentKind)[keyof typeof CommentKind];

export const LoginTokenStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
} as const;
export type LoginTokenStatus = (typeof LoginTokenStatus)[keyof typeof LoginTokenStatus];

/** Типы записей в ленте активности задачи и доски (аудит). */
export const ActivityType = {
  BOARD_CREATED: 'BOARD_CREATED',
  BOARD_UPDATED: 'BOARD_UPDATED',
  BOARD_ARCHIVED: 'BOARD_ARCHIVED',
  BOARD_RESTORED: 'BOARD_RESTORED',
  BOARD_OWNERSHIP_TRANSFERRED: 'BOARD_OWNERSHIP_TRANSFERRED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_MOVED: 'TASK_MOVED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_UNASSIGNED: 'TASK_UNASSIGNED',
  TASK_TESTER_CHANGED: 'TASK_TESTER_CHANGED',
  TASK_DUE_DATE_CHANGED: 'TASK_DUE_DATE_CHANGED',
  TASK_PRIORITY_CHANGED: 'TASK_PRIORITY_CHANGED',
  TASK_LABEL_ADDED: 'TASK_LABEL_ADDED',
  TASK_LABEL_REMOVED: 'TASK_LABEL_REMOVED',
  TASK_ARCHIVED: 'TASK_ARCHIVED',
  TASK_RESTORED: 'TASK_RESTORED',
  TASK_DELETED: 'TASK_DELETED',
  TASK_MOVED_TO_BACKLOG: 'TASK_MOVED_TO_BACKLOG',
  TASK_MOVED_TO_BOARD: 'TASK_MOVED_TO_BOARD',
  TASK_LINK_ADDED: 'TASK_LINK_ADDED',
  TASK_LINK_REMOVED: 'TASK_LINK_REMOVED',
  COMMENT_CREATED: 'COMMENT_CREATED',
  COMMENT_UPDATED: 'COMMENT_UPDATED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  CHECKLIST_UPDATED: 'CHECKLIST_UPDATED',
  PARTICIPANT_ADDED: 'PARTICIPANT_ADDED',
  PARTICIPANT_REMOVED: 'PARTICIPANT_REMOVED',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

/** Типы уведомлений — определяют и текст в UI, и шаблон сообщения в Telegram. */
export const NotificationType = {
  TASK_ASSIGNED_TO_YOU: 'TASK_ASSIGNED_TO_YOU',
  TASK_UNASSIGNED_FROM_YOU: 'TASK_UNASSIGNED_FROM_YOU',
  TASK_TESTER_ASSIGNED: 'TASK_TESTER_ASSIGNED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_RETURNED: 'TASK_RETURNED',
  TASK_PUT_ON_HOLD: 'TASK_PUT_ON_HOLD',
  TASK_DUE_DATE_CHANGED: 'TASK_DUE_DATE_CHANGED',
  TASK_DUE_SOON: 'TASK_DUE_SOON',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_ARCHIVED: 'TASK_ARCHIVED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  MENTIONED: 'MENTIONED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  BOARD_INVITED: 'BOARD_INVITED',
  BOARD_MEMBER_JOINED: 'BOARD_MEMBER_JOINED',
  BOARD_ROLE_CHANGED: 'BOARD_ROLE_CHANGED',
  BOARD_REMOVED: 'BOARD_REMOVED',
  DAILY_DIGEST: 'DAILY_DIGEST',
  SECURITY_ALERT: 'SECURITY_ALERT',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * Уведомления, которые нельзя отключить: личное упоминание, назначение и безопасность.
 * Иначе люди пропускают адресованное лично им.
 */
export const UNMUTABLE_NOTIFICATIONS: readonly NotificationType[] = [
  NotificationType.MENTIONED,
  NotificationType.SECURITY_ALERT,
  NotificationType.TASK_ASSIGNED_TO_YOU,
];

export const SecurityEventType = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_CODE_ISSUED: 'LOGIN_CODE_ISSUED',
  LOGIN_CODE_APPROVED: 'LOGIN_CODE_APPROVED',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PROFILE_COMPLETED: 'PROFILE_COMPLETED',
  GLOBAL_ROLE_CHANGED: 'GLOBAL_ROLE_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  RATE_LIMITED: 'RATE_LIMITED',
  FORBIDDEN_ACCESS: 'FORBIDDEN_ACCESS',
} as const;
export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

export const AuthProvider = {
  TELEGRAM_BOT_CODE: 'TELEGRAM_BOT_CODE',
  TELEGRAM_WIDGET: 'TELEGRAM_WIDGET',
  TELEGRAM_MINI_APP: 'TELEGRAM_MINI_APP',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];
