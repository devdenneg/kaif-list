import type { ColumnKey } from './enums.js';

/** Контракт реалтайма. Имена событий одинаковы на сервере и клиенте. */

export const SOCKET_EVENTS = {
  // клиент -> сервер
  BOARD_SUBSCRIBE: 'board:subscribe',
  BOARD_UNSUBSCRIBE: 'board:unsubscribe',
  TASK_SUBSCRIBE: 'task:subscribe',
  TASK_UNSUBSCRIBE: 'task:unsubscribe',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',

  // сервер -> клиент
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_MOVED: 'task:moved',
  TASK_DELETED: 'task:deleted',
  BOARD_UPDATED: 'board:updated',
  BOARD_MEMBERS_CHANGED: 'board:members:changed',
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  ATTACHMENT_CHANGED: 'attachment:changed',
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_COUNT: 'notification:count',
  PRESENCE_SYNC: 'presence:sync',
  TYPING: 'typing',
  SESSION_REVOKED: 'session:revoked',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface TaskMovedPayload {
  boardId: string;
  taskId: string;
  fromColumn: ColumnKey;
  toColumn: ColumnKey;
  rank: string;
  actorId: string;
  /** Причина переноса, если она требовалась. */
  reason?: string | null;
}

export interface TaskChangedPayload {
  boardId: string;
  taskId: string;
  actorId: string;
  /** Какие поля изменились — клиент может точечно инвалидировать кеш. */
  fields?: string[];
}

export interface CommentChangedPayload {
  boardId: string;
  taskId: string;
  commentId: string;
  actorId: string;
}

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Задача, которую пользователь сейчас смотрит. */
  taskId?: string | null;
}

export interface PresenceSyncPayload {
  boardId: string;
  users: PresenceUser[];
}

export interface TypingPayload {
  taskId: string;
  userId: string;
  displayName: string;
  typing: boolean;
}

export interface NotificationCountPayload {
  unread: number;
}

/** Имена комнат Socket.IO. */
export const rooms = {
  board: (boardId: string) => `board:${boardId}`,
  task: (taskId: string) => `task:${taskId}`,
  user: (userId: string) => `user:${userId}`,
};
