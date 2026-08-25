import {
  ActivityType,
  BOARD_COLORS,
  BoardRole,
  COLUMN_LABELS,
  COLUMN_ORDER,
  ColumnKey,
  DEFAULT_BOARD_SETTINGS,
  GlobalRole,
  NotificationType,
  SOCKET_EVENTS,
  canAssignBoardRole,
  canRemoveBoardMember,
  mergeBoardSettings,
  rooms,
  type BoardDto,
  type BoardGroupDto,
  type BoardMemberDto,
  type BoardSummaryDto,
  type CreateBoardInput,
  type LabelDto,
  type MemberWorkloadDto,
  type UpdateBoardInput,
} from '@kaif/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { mapColumns, mapPublicUser, publicUserSelect } from '../../lib/mappers.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification } from '../../services/notify.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { sanitizePlainText } from '../../lib/sanitize.js';
import { assertCan, type BoardContext, type RequestUser } from '../../lib/rbac.js';
import { ensureUniqueBoardKey, suggestBoardKey } from './keys.js';

/** Стартовый набор меток — чтобы доска не была пустой в первый день. */
const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: 'Баг', color: '#ef4444' },
  { name: 'Фича', color: '#22c55e' },
  { name: 'Срочно', color: '#f97316' },
  { name: 'Документация', color: '#0ea5e9' },
  { name: 'Техдолг', color: '#64748b' },
];

// ─────────────────────────────── Создание доски ─────────────────────────────

/**
 * Создатель доски автоматически становится её владельцем.
 * Доска, участник-владелец, шесть колонок и метки создаются одной транзакцией:
 * недосозданной доски в базе появиться не может.
 */
export async function createBoard(user: RequestUser, input: CreateBoardInput): Promise<BoardDto> {
  const name = sanitizePlainText(input.name, 64);
  const key = input.key
    ? await assertKeyAvailable(input.key)
    : await ensureUniqueBoardKey(suggestBoardKey(name));

  const color =
    input.color ?? BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)] ?? '#6366f1';

  const memberIds = [...new Set(input.memberIds ?? [])].filter((id) => id !== user.id);
  const validMembers =
    memberIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: memberIds }, isActive: true },
          select: { id: true },
        })
      : [];

  const board = await prisma.$transaction(async (tx) => {
    const created = await tx.board.create({
      data: {
        key,
        name,
        description: input.description ? sanitizePlainText(input.description, 2000) : null,
        color,
        icon: input.icon ?? null,
        ownerId: user.id,
        settings: DEFAULT_BOARD_SETTINGS as object,
        members: {
          create: [
            { userId: user.id, role: BoardRole.OWNER, addedById: user.id },
            ...validMembers.map((member) => ({
              userId: member.id,
              role: BoardRole.MEMBER,
              addedById: user.id,
            })),
          ],
        },
        columns: {
          create: COLUMN_ORDER.map((columnKey, index) => ({
            key: columnKey,
            name: COLUMN_LABELS[columnKey],
            order: index,
          })),
        },
        labels: {
          create: DEFAULT_LABELS.map((label) => ({ name: label.name, color: label.color })),
        },
      },
      select: { id: true },
    });

    await recordActivity(tx, {
      boardId: created.id,
      actorId: user.id,
      type: ActivityType.BOARD_CREATED,
      payload: { name, key },
    });

    return created;
  });

  if (validMembers.length > 0) {
    await dispatchNotification({
      type: NotificationType.BOARD_INVITED,
      recipientIds: validMembers.map((m) => m.id),
      actorId: user.id,
      boardId: board.id,
      payload: { boardName: name, boardKey: key, actorName: user.displayName, role: 'Участник' },
    });
  }

  return getBoard(user, board.id);
}

async function assertKeyAvailable(key: string): Promise<string> {
  const existing = await prisma.board.findUnique({ where: { key }, select: { id: true } });
  if (existing) {
    throw new ConflictError('Доска с таким ключом уже существует', 'BOARD_KEY_TAKEN', {
      key: 'Такой ключ уже занят',
    });
  }
  return key;
}

// ──────────────────────────────── Список досок ──────────────────────────────

export async function listBoards(
  user: RequestUser,
  options: { includeArchived?: boolean } = {},
): Promise<BoardSummaryDto[]> {
  const isSuperAdmin = user.globalRole === GlobalRole.SUPERADMIN;

  const boards = await prisma.board.findMany({
    where: {
      ...(options.includeArchived ? {} : { isArchived: false }),
      ...(isSuperAdmin ? {} : { members: { some: { userId: user.id } } }),
    },
    orderBy: [{ isArchived: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      color: true,
      icon: true,
      ownerId: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      members: {
        take: 6,
        orderBy: { createdAt: 'asc' },
        select: { user: { select: publicUserSelect } },
      },
      _count: { select: { members: true } },
    },
  });

  if (boards.length === 0) return [];

  const boardIds = boards.map((b) => b.id);
  const [myMemberships, favorites, taskStats, overdue, backlog] = await Promise.all([
    prisma.boardMember.findMany({
      where: { boardId: { in: boardIds }, userId: user.id },
      select: { boardId: true, role: true },
    }),
    prisma.boardFavorite.findMany({
      where: { boardId: { in: boardIds }, userId: user.id },
      select: { boardId: true },
    }),
    prisma.task.groupBy({
      by: ['boardId', 'columnKey'],
      where: { boardId: { in: boardIds }, archivedAt: null, isBacklog: false },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['boardId'],
      where: {
        boardId: { in: boardIds },
        archivedAt: null,
        isBacklog: false,
        columnKey: { not: ColumnKey.DONE },
        dueDate: { lt: new Date() },
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['boardId'],
      where: { boardId: { in: boardIds }, archivedAt: null, isBacklog: true },
      _count: { _all: true },
    }),
  ]);

  const roleByBoard = new Map(myMemberships.map((m) => [m.boardId, m.role]));
  const favoriteSet = new Set(favorites.map((f) => f.boardId));
  const overdueByBoard = new Map(overdue.map((row) => [row.boardId, row._count._all]));
  const backlogByBoard = new Map(backlog.map((row) => [row.boardId, row._count._all]));

  const totals = new Map<string, { tasks: number; done: number }>();
  for (const row of taskStats) {
    const current = totals.get(row.boardId) ?? { tasks: 0, done: 0 };
    current.tasks += row._count._all;
    if (row.columnKey === ColumnKey.DONE) current.done += row._count._all;
    totals.set(row.boardId, current);
  }

  return boards.map((board) => {
    const counts = totals.get(board.id) ?? { tasks: 0, done: 0 };
    return {
      id: board.id,
      key: board.key,
      name: board.name,
      description: board.description,
      color: board.color,
      icon: board.icon,
      ownerId: board.ownerId,
      isArchived: board.isArchived,
      isFavorite: favoriteSet.has(board.id),
      myRole: roleByBoard.get(board.id) ?? BoardRole.OWNER,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
      counts: {
        tasks: counts.tasks,
        done: counts.done,
        overdue: overdueByBoard.get(board.id) ?? 0,
        members: board._count.members,
        backlog: backlogByBoard.get(board.id) ?? 0,
      },
      memberPreview: board.members.map((m) => mapPublicUser(m.user)),
    } satisfies BoardSummaryDto;
  });
}

// ───────────────────────────────── Одна доска ───────────────────────────────

export async function getBoard(user: RequestUser, boardIdOrKey: string): Promise<BoardDto> {
  const isKey = /^[A-Z][A-Z0-9]{1,7}$/.test(boardIdOrKey);
  const board = await prisma.board.findFirst({
    where: isKey ? { key: boardIdOrKey } : { id: boardIdOrKey },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      color: true,
      icon: true,
      ownerId: true,
      isArchived: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: publicUserSelect },
      columns: { select: { key: true, name: true, order: true, wipLimit: true } },
      labels: {
        orderBy: { name: 'asc' },
        select: { id: true, boardId: true, name: true, color: true, description: true },
      },
      members: {
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: { select: publicUserSelect },
        },
      },
      groups: {
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          boardId: true,
          name: true,
          color: true,
          order: true,
          members: { select: { user: { select: publicUserSelect } } },
        },
      },
      _count: { select: { members: true } },
    },
  });

  if (!board) throw new NotFoundError('Доска не найдена', 'BOARD_NOT_FOUND');

  const isSuperAdmin = user.globalRole === GlobalRole.SUPERADMIN;
  const myMembership = board.members.find((m) => m.userId === user.id);
  if (!myMembership && !isSuperAdmin) throw new NotFoundError('Доска не найдена', 'BOARD_NOT_FOUND');

  const [columnCounts, overdueCount, backlogCount, favorite] = await Promise.all([
    prisma.task.groupBy({
      by: ['columnKey'],
      where: { boardId: board.id, archivedAt: null, isBacklog: false },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: {
        boardId: board.id,
        archivedAt: null,
        isBacklog: false,
        columnKey: { not: ColumnKey.DONE },
        dueDate: { lt: new Date() },
      },
    }),
    prisma.task.count({ where: { boardId: board.id, archivedAt: null, isBacklog: true } }),
    prisma.boardFavorite.findUnique({
      where: { userId_boardId: { userId: user.id, boardId: board.id } },
      select: { boardId: true },
    }),
  ]);

  const countsByColumn: Record<string, number> = {};
  let totalTasks = 0;
  let doneTasks = 0;
  for (const row of columnCounts) {
    countsByColumn[row.columnKey] = row._count._all;
    totalTasks += row._count._all;
    if (row.columnKey === ColumnKey.DONE) doneTasks += row._count._all;
  }

  return {
    id: board.id,
    key: board.key,
    name: board.name,
    description: board.description,
    color: board.color,
    icon: board.icon,
    ownerId: board.ownerId,
    isArchived: board.isArchived,
    isFavorite: favorite !== null,
    myRole: myMembership?.role ?? BoardRole.OWNER,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    counts: {
      tasks: totalTasks,
      done: doneTasks,
      overdue: overdueCount,
      members: board._count.members,
      backlog: backlogCount,
    },
    memberPreview: board.members.slice(0, 6).map((m) => mapPublicUser(m.user)),
    settings: mergeBoardSettings(board.settings),
    columns: mapColumns(board.columns, countsByColumn),
    labels: board.labels as LabelDto[],
    members: board.members.map(
      (member): BoardMemberDto => ({
        userId: member.userId,
        role: member.role,
        user: mapPublicUser(member.user),
        addedAt: member.createdAt.toISOString(),
      }),
    ),
    groups: board.groups.map(
      (group): BoardGroupDto => ({
        id: group.id,
        boardId: group.boardId,
        name: group.name,
        color: group.color,
        order: group.order,
        members: group.members.map((member) => mapPublicUser(member.user)),
      }),
    ),
    owner: mapPublicUser(board.owner),
  };
}

// ─────────────────────────────── Обновление ─────────────────────────────────

export async function updateBoard(
  user: RequestUser,
  context: BoardContext,
  input: UpdateBoardInput,
): Promise<BoardDto> {
  assertCan(user, context, 'board.update');

  const settings = input.settings
    ? mergeBoardSettings({ ...context.board.settings, ...input.settings })
    : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.board.update({
      where: { id: context.board.id },
      data: {
        ...(input.name !== undefined ? { name: sanitizePlainText(input.name, 64) } : {}),
        ...(input.description !== undefined
          ? { description: input.description ? sanitizePlainText(input.description, 2000) : null }
          : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(settings ? { settings: settings as object } : {}),
      },
    });

    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.BOARD_UPDATED,
      payload: { fields: Object.keys(input) },
    });
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_UPDATED,
    data: { boardId: context.board.id },
  });

  return getBoard(user, context.board.id);
}

export async function setBoardArchived(
  user: RequestUser,
  context: BoardContext,
  archived: boolean,
): Promise<BoardDto> {
  assertCan(user, context, 'board.archive');

  await prisma.$transaction(async (tx) => {
    await tx.board.update({
      where: { id: context.board.id },
      data: { isArchived: archived, archivedAt: archived ? new Date() : null },
    });
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: archived ? ActivityType.BOARD_ARCHIVED : ActivityType.BOARD_RESTORED,
    });
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_UPDATED,
    data: { boardId: context.board.id },
  });

  return getBoard(user, context.board.id);
}

export async function deleteBoard(
  user: RequestUser,
  context: BoardContext,
  confirm: string,
): Promise<void> {
  assertCan(user, context, 'board.delete');
  if (confirm.trim().toUpperCase() !== context.board.key) {
    throw new BadRequestError('Для подтверждения введите ключ доски', {
      confirm: `Введите «${context.board.key}»`,
    });
  }
  // Все связанные сущности удаляются каскадом на уровне БД.
  await prisma.board.delete({ where: { id: context.board.id } });
}

export async function transferOwnership(
  user: RequestUser,
  context: BoardContext,
  newOwnerId: string,
  confirm: string,
): Promise<BoardDto> {
  assertCan(user, context, 'board.transferOwnership');
  if (confirm.trim().toUpperCase() !== context.board.key) {
    throw new BadRequestError('Для подтверждения введите ключ доски', {
      confirm: `Введите «${context.board.key}»`,
    });
  }
  if (newOwnerId === context.board.ownerId) {
    throw new BadRequestError('Этот пользователь уже владелец доски');
  }

  const target = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: context.board.id, userId: newOwnerId } },
    select: { userId: true },
  });
  if (!target) throw new BadRequestError('Новый владелец должен быть участником доски');

  await prisma.$transaction(async (tx) => {
    await tx.boardMember.update({
      where: { boardId_userId: { boardId: context.board.id, userId: context.board.ownerId } },
      data: { role: BoardRole.ADMIN },
    });
    await tx.boardMember.update({
      where: { boardId_userId: { boardId: context.board.id, userId: newOwnerId } },
      data: { role: BoardRole.OWNER },
    });
    await tx.board.update({ where: { id: context.board.id }, data: { ownerId: newOwnerId } });
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.BOARD_OWNERSHIP_TRANSFERRED,
      payload: { from: context.board.ownerId, to: newOwnerId },
    });
  });

  await dispatchNotification({
    type: NotificationType.BOARD_ROLE_CHANGED,
    recipientIds: [newOwnerId],
    actorId: user.id,
    boardId: context.board.id,
    payload: { boardName: context.board.name, actorName: user.displayName, role: 'Владелец' },
  });

  return getBoard(user, context.board.id);
}

export async function toggleFavorite(
  user: RequestUser,
  boardId: string,
  favorite: boolean,
): Promise<void> {
  if (favorite) {
    await prisma.boardFavorite.upsert({
      where: { userId_boardId: { userId: user.id, boardId } },
      create: { userId: user.id, boardId },
      update: {},
    });
  } else {
    await prisma.boardFavorite.deleteMany({ where: { userId: user.id, boardId } });
  }
}

// ──────────────────────────────── Участники ─────────────────────────────────

export async function addMember(
  user: RequestUser,
  context: BoardContext,
  userId: string,
  role: BoardRole,
): Promise<BoardMemberDto> {
  assertCan(user, context, 'board.member.invite');
  if (!canAssignBoardRole(context.membershipRole, null, role, { actorIsSuperAdmin: context.isSuperAdmin })) {
    throw new ForbiddenError('Нельзя выдать роль выше собственной');
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!target || !target.isActive) throw new NotFoundError('Пользователь не найден');

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: context.board.id, userId } },
    select: { userId: true },
  });
  if (existing) throw new ConflictError('Пользователь уже участник доски');

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.boardMember.create({
      data: { boardId: context.board.id, userId, role, addedById: user.id },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: publicUserSelect },
      },
    });
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.MEMBER_ADDED,
      payload: { userId, role },
    });
    return created;
  });

  await dispatchNotification({
    type: NotificationType.BOARD_INVITED,
    recipientIds: [userId],
    actorId: user.id,
    boardId: context.board.id,
    payload: {
      boardName: context.board.name,
      actorName: user.displayName,
      role: roleLabel(role),
    },
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_MEMBERS_CHANGED,
    data: { boardId: context.board.id },
  });

  return {
    userId: member.userId,
    role: member.role,
    user: mapPublicUser(member.user),
    addedAt: member.createdAt.toISOString(),
  };
}

export async function changeMemberRole(
  user: RequestUser,
  context: BoardContext,
  userId: string,
  role: BoardRole,
): Promise<BoardMemberDto> {
  assertCan(user, context, 'board.member.changeRole');

  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: context.board.id, userId } },
    select: { role: true },
  });
  if (!member) throw new NotFoundError('Участник не найден');

  if (
    !canAssignBoardRole(context.membershipRole, member.role, role, {
      actorIsSuperAdmin: context.isSuperAdmin,
    })
  ) {
    throw new ForbiddenError('Недостаточно прав для изменения этой роли');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.boardMember.update({
      where: { boardId_userId: { boardId: context.board.id, userId } },
      data: { role },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: publicUserSelect },
      },
    });
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.MEMBER_ROLE_CHANGED,
      payload: { userId, from: member.role, to: role },
    });
    return result;
  });

  await dispatchNotification({
    type: NotificationType.BOARD_ROLE_CHANGED,
    recipientIds: [userId],
    actorId: user.id,
    boardId: context.board.id,
    payload: {
      boardName: context.board.name,
      actorName: user.displayName,
      role: roleLabel(role),
    },
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_MEMBERS_CHANGED,
    data: { boardId: context.board.id },
  });

  return {
    userId: updated.userId,
    role: updated.role,
    user: mapPublicUser(updated.user),
    addedAt: updated.createdAt.toISOString(),
  };
}

export async function removeMember(
  user: RequestUser,
  context: BoardContext,
  userId: string,
): Promise<void> {
  const isSelf = userId === user.id;
  if (!isSelf) assertCan(user, context, 'board.member.remove');

  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: context.board.id, userId } },
    select: { role: true },
  });
  if (!member) throw new NotFoundError('Участник не найден');

  if (
    !canRemoveBoardMember(context.membershipRole, member.role, {
      actorIsSuperAdmin: context.isSuperAdmin,
      isSelf,
    })
  ) {
    throw new ForbiddenError(
      member.role === BoardRole.OWNER
        ? 'Владельца доски нельзя исключить — сначала передайте владение'
        : 'Недостаточно прав',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.boardMember.delete({
      where: { boardId_userId: { boardId: context.board.id, userId } },
    });
    // Снимаем человека с задач этой доски, чтобы не осталось «мёртвых» исполнителей.
    await tx.task.updateMany({
      where: { boardId: context.board.id, assigneeId: userId },
      data: { assigneeId: null },
    });
    await tx.task.updateMany({
      where: { boardId: context.board.id, testerId: userId },
      data: { testerId: null },
    });
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.MEMBER_REMOVED,
      payload: { userId },
    });
  });

  if (!isSelf) {
    await dispatchNotification({
      type: NotificationType.BOARD_REMOVED,
      recipientIds: [userId],
      actorId: user.id,
      boardId: context.board.id,
      payload: { boardName: context.board.name, actorName: user.displayName },
    });
  }

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_MEMBERS_CHANGED,
    data: { boardId: context.board.id },
  });
}

function roleLabel(role: BoardRole): string {
  return (
    { OWNER: 'Владелец', ADMIN: 'Администратор', MEMBER: 'Участник', VIEWER: 'Наблюдатель' }[
      role
    ] ?? role
  );
}

// ──────────────────────────── Нагрузка участников ───────────────────────────

/**
 * Сводка по людям: сколько на ком задач, сколько просрочено.
 * Используется панелью «Люди» и подсказками при назначении.
 */
export async function memberWorkload(context: BoardContext): Promise<MemberWorkloadDto[]> {
  const members = await prisma.boardMember.findMany({
    where: { boardId: context.board.id },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { userId: true, role: true, user: { select: publicUserSelect } },
  });
  if (members.length === 0) return [];

  const userIds = members.map((m) => m.userId);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [byColumn, overdue, dueToday, done30d] = await Promise.all([
    prisma.task.groupBy({
      by: ['assigneeId', 'columnKey'],
      where: {
        boardId: context.board.id,
        assigneeId: { in: userIds },
        archivedAt: null,
        isBacklog: false,
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        boardId: context.board.id,
        assigneeId: { in: userIds },
        archivedAt: null,
        columnKey: { not: ColumnKey.DONE },
        dueDate: { lt: now },
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        boardId: context.board.id,
        assigneeId: { in: userIds },
        archivedAt: null,
        columnKey: { not: ColumnKey.DONE },
        dueDate: { gte: startOfDay, lt: endOfDay },
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        boardId: context.board.id,
        assigneeId: { in: userIds },
        completedAt: { gte: monthAgo },
      },
      _count: { _all: true },
    }),
  ]);

  const columnMap = new Map<string, Record<string, number>>();
  for (const row of byColumn) {
    if (!row.assigneeId) continue;
    const current = columnMap.get(row.assigneeId) ?? {};
    current[row.columnKey] = row._count._all;
    columnMap.set(row.assigneeId, current);
  }

  const toMap = (rows: { assigneeId: string | null; _count: { _all: number } }[]) =>
    new Map(rows.filter((r) => r.assigneeId).map((r) => [r.assigneeId as string, r._count._all]));

  const overdueMap = toMap(overdue);
  const todayMap = toMap(dueToday);
  const doneMap = toMap(done30d);

  return members.map((member) => {
    const columns = columnMap.get(member.userId) ?? {};
    const active = Object.entries(columns)
      .filter(([key]) => key !== ColumnKey.DONE)
      .reduce((sum, [, count]) => sum + count, 0);

    return {
      user: mapPublicUser(member.user),
      role: member.role,
      active,
      inProgress: columns[ColumnKey.IN_PROGRESS] ?? 0,
      qa: columns[ColumnKey.QA] ?? 0,
      overdue: overdueMap.get(member.userId) ?? 0,
      dueToday: todayMap.get(member.userId) ?? 0,
      done30d: doneMap.get(member.userId) ?? 0,
    } satisfies MemberWorkloadDto;
  });
}

// ─────────────────────────────────── Метки ──────────────────────────────────

export async function createLabel(
  user: RequestUser,
  context: BoardContext,
  input: { name: string; color: string; description?: string },
): Promise<LabelDto> {
  assertCan(user, context, 'board.label.manage');
  const name = sanitizePlainText(input.name, 32);
  const existing = await prisma.label.findUnique({
    where: { boardId_name: { boardId: context.board.id, name } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Метка с таким названием уже есть');

  const label = await prisma.label.create({
    data: {
      boardId: context.board.id,
      name,
      color: input.color,
      description: input.description ? sanitizePlainText(input.description, 200) : null,
    },
    select: { id: true, boardId: true, name: true, color: true, description: true },
  });
  return label;
}

export async function updateLabel(
  user: RequestUser,
  context: BoardContext,
  labelId: string,
  input: { name?: string; color?: string; description?: string },
): Promise<LabelDto> {
  assertCan(user, context, 'board.label.manage');
  const label = await prisma.label.findFirst({
    where: { id: labelId, boardId: context.board.id },
    select: { id: true },
  });
  if (!label) throw new NotFoundError('Метка не найдена');

  return prisma.label.update({
    where: { id: labelId },
    data: {
      ...(input.name !== undefined ? { name: sanitizePlainText(input.name, 32) } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? sanitizePlainText(input.description, 200) : null }
        : {}),
    },
    select: { id: true, boardId: true, name: true, color: true, description: true },
  });
}

export async function deleteLabel(
  user: RequestUser,
  context: BoardContext,
  labelId: string,
): Promise<void> {
  assertCan(user, context, 'board.label.manage');
  const label = await prisma.label.findFirst({
    where: { id: labelId, boardId: context.board.id },
    select: { id: true },
  });
  if (!label) throw new NotFoundError('Метка не найдена');
  await prisma.label.delete({ where: { id: labelId } });
}

// ─────────────────────────────────── Колонки ────────────────────────────────

export async function updateColumn(
  user: RequestUser,
  context: BoardContext,
  columnKey: ColumnKey,
  input: { name?: string; wipLimit?: number | null },
): Promise<void> {
  assertCan(user, context, 'board.column.manage');
  const column = await prisma.boardColumn.findUnique({
    where: { boardId_key: { boardId: context.board.id, key: columnKey } },
    select: { id: true },
  });
  if (!column) throw new NotFoundError('Колонка не найдена');

  await prisma.boardColumn.update({
    where: { boardId_key: { boardId: context.board.id, key: columnKey } },
    data: {
      ...(input.name !== undefined ? { name: sanitizePlainText(input.name, 40) } : {}),
      ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}),
    },
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.BOARD_UPDATED,
    data: { boardId: context.board.id },
  });
}


// ────────────────────────────── Рабочие группы ──────────────────────────────

/**
 * Группы — это способ смотреть на доску глазами направления, а не человека:
 * «что сейчас у тестирования», «что у разработки». Поэтому они принадлежат
 * доске, а не системе целиком: в разных досках состав команд разный.
 */

const groupSelect = {
  id: true,
  boardId: true,
  name: true,
  color: true,
  order: true,
  members: { select: { user: { select: publicUserSelect } } },
} satisfies Prisma.BoardGroupSelect;

function mapGroup(row: Prisma.BoardGroupGetPayload<{ select: typeof groupSelect }>): BoardGroupDto {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    color: row.color,
    order: row.order,
    members: row.members.map((member) => mapPublicUser(member.user)),
  };
}

export async function listBoardGroups(
  user: RequestUser,
  context: BoardContext,
): Promise<BoardGroupDto[]> {
  assertCan(user, context, 'board.view');
  const groups = await prisma.boardGroup.findMany({
    where: { boardId: context.board.id },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: groupSelect,
  });
  return groups.map(mapGroup);
}

export async function createBoardGroup(
  user: RequestUser,
  context: BoardContext,
  input: { name: string; color?: string; userIds?: string[] },
): Promise<BoardGroupDto> {
  assertCan(user, context, 'board.settings.manage');

  const name = sanitizePlainText(input.name, 32);
  const existing = await prisma.boardGroup.findUnique({
    where: { boardId_name: { boardId: context.board.id, name } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Группа с таким названием уже есть');

  const memberIds = await filterBoardMembers(context.board.id, input.userIds);
  const count = await prisma.boardGroup.count({ where: { boardId: context.board.id } });

  const group = await prisma.boardGroup.create({
    data: {
      boardId: context.board.id,
      name,
      color: input.color ?? BOARD_COLORS[count % BOARD_COLORS.length] ?? '#6366f1',
      order: count,
      ...(memberIds.length > 0
        ? { members: { create: memberIds.map((userId) => ({ userId })) } }
        : {}),
    },
    select: groupSelect,
  });

  await notifyBoardChanged(context.board.id);
  return mapGroup(group);
}

export async function updateBoardGroup(
  user: RequestUser,
  context: BoardContext,
  groupId: string,
  input: { name?: string; color?: string; order?: number },
): Promise<BoardGroupDto> {
  assertCan(user, context, 'board.settings.manage');
  await assertGroupOnBoard(context.board.id, groupId);

  const group = await prisma.boardGroup.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined ? { name: sanitizePlainText(input.name, 32) } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
    select: groupSelect,
  });

  await notifyBoardChanged(context.board.id);
  return mapGroup(group);
}

export async function deleteBoardGroup(
  user: RequestUser,
  context: BoardContext,
  groupId: string,
): Promise<void> {
  assertCan(user, context, 'board.settings.manage');
  await assertGroupOnBoard(context.board.id, groupId);
  await prisma.boardGroup.delete({ where: { id: groupId } });
  await notifyBoardChanged(context.board.id);
}

/**
 * Состав группы задаётся целиком, а не по одному человеку: интерфейс
 * работает списком с галочками, и частичные операции только плодили бы
 * рассинхрон между тем, что видно на экране, и тем, что в базе.
 */
export async function setBoardGroupMembers(
  user: RequestUser,
  context: BoardContext,
  groupId: string,
  userIds: string[],
): Promise<BoardGroupDto> {
  assertCan(user, context, 'board.settings.manage');
  await assertGroupOnBoard(context.board.id, groupId);

  const memberIds = await filterBoardMembers(context.board.id, userIds);

  const group = await prisma.$transaction(async (tx) => {
    await tx.boardGroupMember.deleteMany({ where: { groupId } });
    if (memberIds.length > 0) {
      await tx.boardGroupMember.createMany({
        data: memberIds.map((userId) => ({ groupId, userId })),
      });
    }
    return tx.boardGroup.findUniqueOrThrow({ where: { id: groupId }, select: groupSelect });
  });

  await notifyBoardChanged(context.board.id);
  return mapGroup(group);
}

async function assertGroupOnBoard(boardId: string, groupId: string): Promise<void> {
  const group = await prisma.boardGroup.findFirst({
    where: { id: groupId, boardId },
    select: { id: true },
  });
  if (!group) throw new NotFoundError('Группа не найдена');
}

/** В группу попадают только те, кто действительно есть на доске. */
async function filterBoardMembers(boardId: string, userIds?: string[]): Promise<string[]> {
  if (!userIds || userIds.length === 0) return [];
  const members = await prisma.boardMember.findMany({
    where: { boardId, userId: { in: [...new Set(userIds)] } },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/** Состав групп виден всем на доске — сообщаем об изменении сразу. */
async function notifyBoardChanged(boardId: string): Promise<void> {
  await publishRealtime({
    room: rooms.board(boardId),
    event: SOCKET_EVENTS.BOARD_UPDATED,
    data: { boardId },
  });
}
