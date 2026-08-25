import type {
  ActivityType,
  BoardRole,
  ColumnKey,
  CommentKind,
  GlobalRole,
  NotificationType,
  ParticipantRole,
  TaskLinkType,
  TaskPriority,
  TaskType,
} from './enums.js';
import type { BoardSettings } from './rules.js';
import type { NotificationPreferences } from './notifications.js';
import type { RichTextDoc } from './richtext.js';

/** Публичный профиль — то, что видят коллеги. */
export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  tgUsername: string | null;
  isActive: boolean;
}

/** Профиль текущего пользователя. */
export interface CurrentUser extends PublicUser {
  telegramId: string;
  globalRole: GlobalRole;
  profileCompleted: boolean;
  timezone: string;
  locale: string;
  /** Бот запущен и может писать пользователю. */
  botLinked: boolean;
  botBlocked: boolean;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Секунды до истечения access-токена. */
  expiresIn: number;
}

export interface AuthResult extends AuthTokens {
  user: CurrentUser;
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface LoginCodeDto {
  code: string;
  /** Готовая ссылка на бота: `https://t.me/<bot>?start=<code>`. */
  deepLink: string;
  botUsername: string;
  expiresAt: string;
  pollIntervalMs: number;
}

export interface LoginCodeStatusDto {
  status: 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED';
}

export interface LabelDto {
  id: string;
  boardId: string;
  name: string;
  color: string;
  description: string | null;
  taskCount?: number;
}

export interface BoardColumnDto {
  key: ColumnKey;
  name: string;
  order: number;
  wipLimit: number | null;
  taskCount: number;
}

export interface BoardMemberDto {
  userId: string;
  role: BoardRole;
  user: PublicUser;
  addedAt: string;
  /** Сколько активных задач на человеке в этой доске. */
  activeTasks?: number;
  overdueTasks?: number;
}

export interface BoardSummaryDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  ownerId: string;
  isArchived: boolean;
  isFavorite: boolean;
  myRole: BoardRole;
  createdAt: string;
  updatedAt: string;
  counts: {
    tasks: number;
    done: number;
    overdue: number;
    members: number;
    backlog: number;
  };
  memberPreview: PublicUser[];
}

export interface BoardDto extends BoardSummaryDto {
  settings: BoardSettings;
  columns: BoardColumnDto[];
  labels: LabelDto[];
  members: BoardMemberDto[];
  owner: PublicUser;
}

export interface TaskLabelRef {
  id: string;
  name: string;
  color: string;
}

/** Карточка на доске — намеренно лёгкая, без описания и комментариев. */
export interface TaskCardDto {
  id: string;
  key: string;
  boardId: string;
  title: string;
  type: TaskType;
  priority: TaskPriority;
  columnKey: ColumnKey;
  rank: string;
  isBacklog: boolean;
  assignee: PublicUser | null;
  tester: PublicUser | null;
  reporter: PublicUser;
  labels: TaskLabelRef[];
  dueDate: string | null;
  startDate: string | null;
  storyPoints: number | null;
  estimateMinutes: number | null;
  spentMinutes: number | null;
  commentCount: number;
  attachmentCount: number;
  checklistTotal: number;
  checklistDone: number;
  blockedByCount: number;
  isArchived: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  /** Короткое превью описания для карточки. */
  descriptionPreview: string | null;
}

export interface ChecklistItemDto {
  id: string;
  text: string;
  done: boolean;
  rank: string;
  assignee: PublicUser | null;
  dueDate: string | null;
  completedAt: string | null;
}

export interface ChecklistDto {
  id: string;
  title: string;
  rank: string;
  items: ChecklistItemDto[];
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  isImage: boolean;
  url: string;
  thumbnailUrl: string | null;
  uploader: PublicUser;
  createdAt: string;
}

export interface TaskParticipantDto {
  user: PublicUser;
  roles: ParticipantRole[];
  addedAt: string;
}

export interface TaskLinkDto {
  id: string;
  type: TaskLinkType;
  task: Pick<TaskCardDto, 'id' | 'key' | 'title' | 'columnKey' | 'type' | 'priority'> & {
    isArchived: boolean;
  };
}

export interface CommentReactionDto {
  emoji: string;
  count: number;
  /** Кто поставил — показывается в подсказке. */
  users: PublicUser[];
  /** Текущий пользователь уже отреагировал. */
  mine: boolean;
}

export interface CommentDto {
  id: string;
  taskId: string;
  kind: CommentKind;
  author: PublicUser | null;
  body: RichTextDoc | null;
  bodyText: string;
  parentId: string | null;
  attachments: AttachmentDto[];
  /** Для системных записей: что именно произошло. */
  systemMeta: SystemCommentMeta | null;
  createdAt: string;
  editedAt: string | null;
  isDeleted: boolean;
  replyCount: number;
  reactions: CommentReactionDto[];
}

export interface SystemCommentMeta {
  kind: 'MOVE' | 'DUE_DATE' | 'ASSIGNEE' | 'ARCHIVE' | 'OTHER';
  from?: string | null;
  to?: string | null;
  reasonCode?: string;
}

export interface ActivityDto {
  id: string;
  type: ActivityType;
  actor: PublicUser | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  boardId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetailDto extends TaskCardDto {
  description: RichTextDoc | null;
  descriptionText: string;
  checklists: ChecklistDto[];
  attachments: AttachmentDto[];
  participants: TaskParticipantDto[];
  links: TaskLinkDto[];
  watching: boolean;
  board: Pick<BoardSummaryDto, 'id' | 'key' | 'name' | 'color'> & { myRole: BoardRole };
  /** Что текущий пользователь может делать с этой задачей. */
  permissions: TaskPermissions;
}

export interface TaskPermissions {
  canUpdate: boolean;
  canMove: boolean;
  canComment: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canAttach: boolean;
  canManageLinks: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  actor: PublicUser | null;
  boardId: string | null;
  boardName: string | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Сохранённый набор фильтров доски. */
export interface SavedViewDto {
  id: string;
  name: string;
  boardId: string | null;
  filters: SavedViewFilters;
  /** Фильтр виден всей доске, а не только автору. */
  isShared: boolean;
  /** Фильтр создан текущим пользователем — значит, его можно удалить. */
  isOwn: boolean;
  createdAt: string;
}

export interface SavedViewFilters {
  search?: string;
  assigneeIds?: string[];
  labelIds?: string[];
  priorities?: TaskPriority[];
  types?: TaskType[];
  due?: 'any' | 'overdue' | 'today' | 'week' | 'none' | 'has';
  unassigned?: boolean;
  includeArchived?: boolean;
}

/** Сводка по человеку — для панели «Люди». */
export interface MemberWorkloadDto {
  user: PublicUser;
  role: BoardRole;
  active: number;
  inProgress: number;
  qa: number;
  overdue: number;
  dueToday: number;
  done30d: number;
}

export interface BoardAnalyticsDto {
  throughput: { date: string; done: number; created: number }[];
  cycleTimeDays: { median: number; average: number; p90: number };
  byPriority: { priority: TaskPriority; count: number }[];
  byColumn: { column: ColumnKey; count: number }[];
  byAssignee: { user: PublicUser; count: number; overdue: number }[];
  bottlenecks: { column: ColumnKey; averageDaysStuck: number }[];
  overdueCount: number;
  unassignedCount: number;
}

/** Единый формат ошибки API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Ошибки по полям формы. */
    fields?: Record<string, string>;
    /** Для 422 из-за отсутствия обязательной причины. */
    reasonRequired?: { code: string; message: string };
    requestId?: string;
  };
}
