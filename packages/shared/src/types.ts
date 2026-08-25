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
  /** Короткий код, который надо сверить с тем, что покажет бот. */
  verificationCode: string;
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

/** Рабочая группа доски: разработка, тестирование и так далее. */
export interface BoardGroupDto {
  id: string;
  boardId: string;
  name: string;
  color: string;
  order: number;
  members: PublicUser[];
}

/** Пригласительная ссылка. Токен отдаётся только тем, кто управляет доской. */
export interface BoardInviteDto {
  id: string;
  boardId: string;
  url: string;
  role: BoardRole;
  /** Вошедший по ссылке сразу попадёт в эту группу. */
  group: { id: string; name: string; color: string } | null;
  maxUses: number | null;
  useCount: number;
  expiresAt: string;
  createdAt: string;
  createdBy: PublicUser;
  isExpired: boolean;
  isExhausted: boolean;
}

/** Что видит человек, открывший приглашение: только витрина доски. */
export interface BoardInvitePreviewDto {
  boardName: string;
  boardKey: string;
  boardColor: string;
  role: BoardRole;
  groupName: string | null;
  invitedBy: PublicUser;
  memberCount: number;
  /** Уже состоит в доске — тогда сразу ведём внутрь. */
  alreadyMember: boolean;
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
  groups: BoardGroupDto[];
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
  /**
   * Сколько раз переносили срок. Хорошая мера того, насколько задача
   * оказалась сложнее, чем думали, — или насколько ей никто не занимается.
   */
  dueDateChangedCount: number;
  /**
   * Когда задачу впервые взяли в работу. Заменяет прежнюю «дату начала»:
   * начало проставлять руками бессмысленно, оно и так известно — это момент,
   * когда человек перетащил карточку в «В работе».
   */
  firstInProgressAt: string | null;
  storyPoints: number | null;
  estimateMinutes: number | null;
  spentMinutes: number | null;
  commentCount: number;
  attachmentCount: number;
  checklistTotal: number;
  checklistDone: number;
  blockedByCount: number;
  isArchived: boolean;
  archivedAt: string | null;
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
  /** Право удалять чужие комментарии — только у администраторов доски. */
  canModerateComments: boolean;
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
  groupIds?: string[];
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

/** Значение за период рядом с таким же прошлым периодом. */
export interface MetricDelta {
  current: number;
  previous: number;
}

export interface DistributionStat {
  median: number;
  average: number;
  p90: number;
  /** По скольким задачам посчитано: одна задача — это ещё не статистика. */
  sample: number;
}

/** Строка таблицы людей. Всё, что можно сказать про человека на этой доске. */
export interface PersonStatsDto {
  user: PublicUser;
  /** Сейчас на человеке. */
  active: number;
  inProgress: number;
  qa: number;
  overdue: number;
  blocked: number;
  /** За выбранный период. */
  completed: number;
  medianCycleDays: number;
  returned: number;
  reported: number;
  tested: number;
}

export interface AttentionTaskDto {
  id: string;
  key: string;
  title: string;
  columnKey: ColumnKey;
  priority: TaskPriority;
  assignee: PublicUser | null;
  dueDate: string | null;
  /** Сколько дней задача не двигалась. */
  idleDays: number;
  returnCount: number;
  blockedByCount: number;
}

export interface BoardAnalyticsDto {
  period: { days: number; from: string; to: string };

  /** Что требует решения прямо сейчас. Самое важное на экране. */
  attentionCounts: {
    overdue: number;
    blocked: number;
    unassigned: number;
    stale: number;
    inProgress: number;
    dueThisWeek: number;
  };

  /** Как идут дела — в сравнении с таким же прошлым периодом. */
  flow: {
    created: MetricDelta;
    completed: MetricDelta;
    cycleTimeDays: MetricDelta;
    returned: MetricDelta;
    reopened: MetricDelta;
  };

  cycleTime: DistributionStat;
  leadTime: DistributionStat;

  throughput: { date: string; created: number; done: number }[];

  /** Сколько задача реально проводит в каждой колонке, дней. */
  columnTime: { column: ColumnKey; medianDays: number; averageDays: number; sample: number }[];

  byPriority: { priority: TaskPriority; count: number }[];
  byType: { type: TaskType; count: number }[];
  byColumn: { column: ColumnKey; count: number }[];

  people: PersonStatsDto[];

  /** Конкретные задачи, с которыми надо что-то делать. */
  attention: {
    overdue: AttentionTaskDto[];
    blocked: AttentionTaskDto[];
    stale: AttentionTaskDto[];
    mostReturned: AttentionTaskDto[];
  };
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
