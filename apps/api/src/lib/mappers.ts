import { Prisma } from '@prisma/client';
import type {
  ActivityDto,
  AttachmentDto,
  BoardColumnDto,
  ChecklistDto,
  CommentDto,
  PublicUser,
  SystemCommentMeta,
  TaskCardDto,
  CommentReactionDto,
  NotificationDto,
  TaskLinkDto,
  TaskParticipantDto,
} from '@kaif/shared';
import {
  COLUMN_LABELS,
  IMAGE_MIME,
  type RichTextDoc,
  type RichTextNode,
} from '@kaif/shared';
import { env } from '../config/env.js';
import { signedAttachmentUrl } from './file-tokens.js';
import { buildNotificationText, type NotificationPayload } from '../services/notification-text.js';

/** Абсолютный URL для аватаров и вложений: в БД хранятся относительные пути. */
export function absoluteUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `${env.API_URL.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
}

// ───────────────────────────────── Пользователь ─────────────────────────────

export const publicUserSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  tgUsername: true,
  isActive: true,
} satisfies Prisma.UserSelect;

export type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function mapPublicUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: absoluteUrl(row.avatarUrl),
    tgUsername: row.tgUsername,
    isActive: row.isActive,
  };
}

export function mapPublicUserOrNull(row: PublicUserRow | null): PublicUser | null {
  return row ? mapPublicUser(row) : null;
}

/** Короткое превью описания для карточки на доске. */
function previewText(text: string, maxLength = 160): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

// ───────────────────────────────── Вложения ─────────────────────────────────

export const attachmentSelect = {
  id: true,
  filename: true,
  mime: true,
  size: true,
  width: true,
  height: true,
  thumbName: true,
  createdAt: true,
  uploader: { select: publicUserSelect },
} satisfies Prisma.AttachmentSelect;

export type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof attachmentSelect }>;

export function mapAttachment(row: AttachmentRow): AttachmentDto {
  const isImage = IMAGE_MIME.includes(row.mime);
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    isImage,
    url: signedAttachmentUrl(row.id),
    thumbnailUrl: row.thumbName ? signedAttachmentUrl(row.id, true) : null,
    uploader: mapPublicUser(row.uploader),
    createdAt: row.createdAt.toISOString(),
  };
}

// ─────────────────────────────────── Задачи ─────────────────────────────────

export const taskCardSelect = {
  id: true,
  key: true,
  boardId: true,
  title: true,
  type: true,
  priority: true,
  columnKey: true,
  rank: true,
  isBacklog: true,
  dueDate: true,
  dueDateChangedCount: true,
  firstInProgressAt: true,
  storyPoints: true,
  estimateMinutes: true,
  spentMinutes: true,
  commentCount: true,
  attachmentCount: true,
  checklistTotal: true,
  checklistDone: true,
  blockedByCount: true,
  archivedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  lastActivityAt: true,
  descriptionText: true,
  assignee: { select: publicUserSelect },
  tester: { select: publicUserSelect },
  reporter: { select: publicUserSelect },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.TaskSelect;

export type TaskCardRow = Prisma.TaskGetPayload<{ select: typeof taskCardSelect }>;

export function mapTaskCard(row: TaskCardRow): TaskCardDto {
  return {
    id: row.id,
    key: row.key,
    boardId: row.boardId,
    title: row.title,
    type: row.type,
    priority: row.priority,
    columnKey: row.columnKey,
    rank: row.rank,
    isBacklog: row.isBacklog,
    assignee: mapPublicUserOrNull(row.assignee),
    tester: mapPublicUserOrNull(row.tester),
    reporter: mapPublicUser(row.reporter),
    labels: row.labels.map((l) => l.label),
    dueDate: row.dueDate?.toISOString() ?? null,
    dueDateChangedCount: row.dueDateChangedCount,
    firstInProgressAt: row.firstInProgressAt?.toISOString() ?? null,
    storyPoints: row.storyPoints,
    estimateMinutes: row.estimateMinutes,
    spentMinutes: row.spentMinutes,
    commentCount: row.commentCount,
    attachmentCount: row.attachmentCount,
    checklistTotal: row.checklistTotal,
    checklistDone: row.checklistDone,
    blockedByCount: row.blockedByCount,
    isArchived: row.archivedAt !== null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    descriptionPreview: previewText(row.descriptionText),
  };
}

export const checklistSelect = {
  id: true,
  title: true,
  rank: true,
  items: {
    orderBy: { rank: 'asc' },
    select: {
      id: true,
      text: true,
      done: true,
      rank: true,
      dueDate: true,
      completedAt: true,
      assignee: { select: publicUserSelect },
    },
  },
} satisfies Prisma.ChecklistSelect;

export type ChecklistRow = Prisma.ChecklistGetPayload<{ select: typeof checklistSelect }>;

export function mapChecklist(row: ChecklistRow): ChecklistDto {
  return {
    id: row.id,
    title: row.title,
    rank: row.rank,
    items: row.items.map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done,
      rank: item.rank,
      assignee: mapPublicUserOrNull(item.assignee),
      dueDate: item.dueDate?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
    })),
  };
}

export const participantSelect = {
  userId: true,
  role: true,
  muted: true,
  createdAt: true,
  user: { select: publicUserSelect },
} satisfies Prisma.TaskParticipantSelect;

export type ParticipantRow = Prisma.TaskParticipantGetPayload<{ select: typeof participantSelect }>;

/** Один человек может быть и автором, и исполнителем — схлопываем в одну карточку. */
export function mapParticipants(rows: ParticipantRow[]): TaskParticipantDto[] {
  const byUser = new Map<string, TaskParticipantDto>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role);
      continue;
    }
    byUser.set(row.userId, {
      user: mapPublicUser(row.user),
      roles: [row.role],
      addedAt: row.createdAt.toISOString(),
    });
  }
  return [...byUser.values()];
}

export const taskLinkSelect = {
  id: true,
  type: true,
  toTask: {
    select: {
      id: true,
      key: true,
      title: true,
      columnKey: true,
      type: true,
      priority: true,
      archivedAt: true,
    },
  },
} satisfies Prisma.TaskLinkSelect;

export type TaskLinkRow = Prisma.TaskLinkGetPayload<{ select: typeof taskLinkSelect }>;

export function mapTaskLink(row: TaskLinkRow): TaskLinkDto {
  return {
    id: row.id,
    type: row.type,
    task: {
      id: row.toTask.id,
      key: row.toTask.key,
      title: row.toTask.title,
      columnKey: row.toTask.columnKey,
      type: row.toTask.type,
      priority: row.toTask.priority,
      isArchived: row.toTask.archivedAt !== null,
    },
  };
}

// ──────────────────────────────── Комментарии ───────────────────────────────

export const commentSelect = {
  id: true,
  taskId: true,
  kind: true,
  bodyJson: true,
  bodyText: true,
  parentId: true,
  systemMeta: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  author: { select: publicUserSelect },
  attachments: { select: attachmentSelect },
  reactions: {
    select: { emoji: true, userId: true, user: { select: publicUserSelect } },
  },
  _count: { select: { replies: true } },
} satisfies Prisma.CommentSelect;

export type CommentRow = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

/**
 * `currentUserId` нужен, чтобы отметить собственные реакции —
 * по ним рисуется подсветка кнопки.
 */
export function mapComment(row: CommentRow, currentUserId?: string): CommentDto {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    author: mapPublicUserOrNull(row.author),
    body: isDeleted ? null : signDocImages((row.bodyJson as RichTextDoc | null) ?? null),
    bodyText: isDeleted ? '' : row.bodyText,
    parentId: row.parentId,
    attachments: isDeleted ? [] : row.attachments.map(mapAttachment),
    systemMeta: (row.systemMeta as SystemCommentMeta | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    isDeleted,
    replyCount: row._count.replies,
    reactions: groupReactions(row.reactions, currentUserId),
  };
}

/** Схлопывает реакции по эмодзи: один эмодзи — одна кнопка со счётчиком. */
function groupReactions(
  rows: { emoji: string; userId: string; user: PublicUserRow }[],
  currentUserId?: string,
): CommentReactionDto[] {
  const byEmoji = new Map<string, CommentReactionDto>();

  for (const row of rows) {
    const existing = byEmoji.get(row.emoji);
    if (existing) {
      existing.count += 1;
      existing.users.push(mapPublicUser(row.user));
      if (row.userId === currentUserId) existing.mine = true;
      continue;
    }
    byEmoji.set(row.emoji, {
      emoji: row.emoji,
      count: 1,
      users: [mapPublicUser(row.user)],
      mine: row.userId === currentUserId,
    });
  }

  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}

// ───────────────────────────────── Активность ───────────────────────────────

export const activitySelect = {
  id: true,
  type: true,
  payload: true,
  createdAt: true,
  boardId: true,
  taskId: true,
  actor: { select: publicUserSelect },
  task: { select: { key: true, title: true } },
} satisfies Prisma.ActivitySelect;

export type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof activitySelect }>;

export function mapActivity(row: ActivityRow): ActivityDto {
  return {
    id: row.id,
    type: row.type,
    actor: mapPublicUserOrNull(row.actor),
    taskId: row.taskId,
    taskKey: row.task?.key ?? null,
    taskTitle: row.task?.title ?? null,
    boardId: row.boardId,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

// ─────────────────────────────────── Колонки ────────────────────────────────

export function mapColumns(
  rows: { key: string; name: string; order: number; wipLimit: number | null }[],
  counts: Record<string, number>,
): BoardColumnDto[] {
  return rows
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((row) => ({
      key: row.key as BoardColumnDto['key'],
      name: row.name || COLUMN_LABELS[row.key as BoardColumnDto['key']],
      order: row.order,
      wipLimit: row.wipLimit,
      taskCount: counts[row.key] ?? 0,
    }));
}

// ──────────────────────────────── Уведомления ───────────────────────────────

export const notificationSelect = {
  id: true,
  userId: true,
  type: true,
  payload: true,
  readAt: true,
  createdAt: true,
  boardId: true,
  taskId: true,
  actor: { select: publicUserSelect },
  board: { select: { name: true } },
  task: { select: { key: true, title: true } },
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

export function mapNotification(row: NotificationRow): NotificationDto {
  const payload = (row.payload as NotificationPayload) ?? {};
  const { title, body } = buildNotificationText(row.type, payload);
  return {
    id: row.id,
    type: row.type,
    title,
    body,
    actor: mapPublicUserOrNull(row.actor),
    boardId: row.boardId,
    boardName: row.board?.name ?? payload.boardName ?? null,
    taskId: row.taskId,
    taskKey: row.task?.key ?? payload.taskKey ?? null,
    taskTitle: row.task?.title ?? payload.taskTitle ?? null,
    payload: payload as Record<string, unknown>,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─────────────────── Подписи для картинок внутри текста ─────────────────────

const ATTACHMENT_SRC = /\/api\/attachments\/([A-Za-z0-9_-]{8,40})(?:\/thumb)?/;

/**
 * В базе картинки хранятся каноническим путём без подписи.
 * При отдаче наружу подставляем свежий подписанный URL — так ссылки
 * не протухают в хранилище и не «утекают» вечными.
 */
export function signDocImages<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc;

  const walk = (node: RichTextNode): RichTextNode => {
    if (node.type === 'image' && node.attrs && typeof node.attrs.src === 'string') {
      const match = ATTACHMENT_SRC.exec(node.attrs.src);
      if (match?.[1]) {
        return {
          ...node,
          attrs: { ...node.attrs, src: signedAttachmentUrl(match[1]) },
        };
      }
    }
    if (Array.isArray(node.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  };

  return walk(doc as RichTextNode) as T;
}
