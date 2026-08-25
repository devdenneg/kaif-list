import {
  BoardRole,
  GlobalRole,
  mergeBoardSettings,
  can,
  type AccessContext,
  type Action,
  type BoardSettings,
} from '@kaif/shared';
import { prisma } from './prisma.js';
import { ForbiddenError, NotFoundError } from './errors.js';

export interface RequestUser {
  id: string;
  sessionId: string;
  globalRole: GlobalRole;
  profileCompleted: boolean;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
}

export interface BoardContext {
  board: {
    id: string;
    key: string;
    name: string;
    color: string;
    ownerId: string;
    isArchived: boolean;
    settings: BoardSettings;
  };
  /** Фактическая роль в BoardMember. `null` — суперадмин, не состоящий в доске. */
  membershipRole: BoardRole | null;
  /** Роль с учётом глобальных полномочий. */
  role: BoardRole;
  isSuperAdmin: boolean;
}

const boardSelect = {
  id: true,
  key: true,
  name: true,
  color: true,
  ownerId: true,
  isArchived: true,
  settings: true,
} as const;

/**
 * Загружает доску вместе с ролью пользователя.
 * Бросает 404, если доска не найдена, и 403, если доступа нет —
 * при этом «нет доступа» тоже отдаётся как 404, чтобы не раскрывать
 * существование чужих досок.
 */
export async function loadBoardContext(
  user: RequestUser,
  boardIdOrKey: string,
): Promise<BoardContext> {
  const isKey = /^[A-Z][A-Z0-9]{1,7}$/.test(boardIdOrKey);
  const board = await prisma.board.findFirst({
    where: isKey ? { key: boardIdOrKey } : { id: boardIdOrKey },
    select: boardSelect,
  });
  if (!board) throw new NotFoundError('Доска не найдена', 'BOARD_NOT_FOUND');

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: user.id } },
    select: { role: true },
  });

  const isSuperAdmin = user.globalRole === GlobalRole.SUPERADMIN;
  if (!membership && !isSuperAdmin) {
    // Не раскрываем факт существования доски.
    throw new NotFoundError('Доска не найдена', 'BOARD_NOT_FOUND');
  }

  return {
    board: { ...board, settings: mergeBoardSettings(board.settings) },
    membershipRole: membership?.role ?? null,
    role: membership?.role ?? BoardRole.OWNER,
    isSuperAdmin,
  };
}

export interface TaskContext extends BoardContext {
  task: {
    id: string;
    key: string;
    boardId: string;
    reporterId: string;
    assigneeId: string | null;
    testerId: string | null;
    columnKey: string;
    isBacklog: boolean;
    archivedAt: Date | null;
    dueDate: Date | null;
    title: string;
  };
}

export async function loadTaskContext(user: RequestUser, taskIdOrKey: string): Promise<TaskContext> {
  const isKey = /^[A-Z][A-Z0-9]{1,7}-\d{1,7}$/.test(taskIdOrKey);
  const task = await prisma.task.findFirst({
    where: isKey ? { key: taskIdOrKey } : { id: taskIdOrKey },
    select: {
      id: true,
      key: true,
      boardId: true,
      reporterId: true,
      assigneeId: true,
      testerId: true,
      columnKey: true,
      isBacklog: true,
      archivedAt: true,
      dueDate: true,
      title: true,
    },
  });
  if (!task) throw new NotFoundError('Задача не найдена', 'TASK_NOT_FOUND');

  const boardContext = await loadBoardContext(user, task.boardId);
  return { ...boardContext, task };
}

export interface AccessExtras {
  isTaskAuthor?: boolean;
  isTaskAssignee?: boolean;
  isTaskTester?: boolean;
  isOwnResource?: boolean;
}

export function buildAccessContext(
  user: RequestUser,
  context: BoardContext,
  extras: AccessExtras = {},
): AccessContext {
  return {
    globalRole: user.globalRole,
    boardRole: context.membershipRole,
    boardArchived: context.board.isArchived,
    ...extras,
  };
}

export function assertCan(
  user: RequestUser,
  context: BoardContext,
  action: Action,
  extras: AccessExtras = {},
): void {
  const allowed = can(buildAccessContext(user, context, extras), action);
  if (!allowed) {
    throw new ForbiddenError(
      context.board.isArchived
        ? 'Доска в архиве — изменения недоступны'
        : 'Недостаточно прав для этого действия',
      context.board.isArchived ? 'BOARD_ARCHIVED' : 'FORBIDDEN',
    );
  }
}

export function assertCanTask(
  user: RequestUser,
  context: TaskContext,
  action: Action,
  extras: AccessExtras = {},
): void {
  assertCan(user, context, action, {
    isTaskAuthor: context.task.reporterId === user.id,
    isTaskAssignee: context.task.assigneeId === user.id,
    isTaskTester: context.task.testerId === user.id,
    ...extras,
  });
}

export function checkTask(
  user: RequestUser,
  context: TaskContext,
  action: Action,
  extras: AccessExtras = {},
): boolean {
  return can(
    buildAccessContext(user, context, {
      isTaskAuthor: context.task.reporterId === user.id,
      isTaskAssignee: context.task.assigneeId === user.id,
      isTaskTester: context.task.testerId === user.id,
      ...extras,
    }),
    action,
  );
}

/** id досок, доступных пользователю. Для суперадмина — все. */
export async function accessibleBoardIds(user: RequestUser): Promise<string[] | 'ALL'> {
  if (user.globalRole === GlobalRole.SUPERADMIN) return 'ALL';
  const memberships = await prisma.boardMember.findMany({
    where: { userId: user.id },
    select: { boardId: true },
  });
  return memberships.map((m) => m.boardId);
}

/** Условие Prisma «доски, которые пользователь имеет право видеть». */
export function boardScopeWhere(boardIds: string[] | 'ALL'): { boardId?: { in: string[] } } {
  return boardIds === 'ALL' ? {} : { boardId: { in: boardIds } };
}
