import { randomBytes } from 'node:crypto';
import {
  ActivityType,
  BoardRole,
  NotificationType,
  SOCKET_EVENTS,
  canAssignBoardRole,
  rooms,
  type BoardInviteDto,
  type BoardInvitePreviewDto,
  type CreateBoardInviteInput,
} from '@kaif/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { mapPublicUser, publicUserSelect } from '../../lib/mappers.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification } from '../../services/notify.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { assertCan, type BoardContext, type RequestUser } from '../../lib/rbac.js';
import { env } from '../../config/env.js';

/**
 * Приглашения на доску.
 *
 * Справочник людей закрыт: никто не видит список всех, кто зарегистрирован
 * в системе. Чтобы позвать человека, владелец создаёт ссылку и передаёт её
 * лично — так круг участников доски остаётся решением владельца, а не
 * следствием того, что кто-то однажды завёл аккаунт.
 *
 * Токен хранится как есть, а не хешем: ссылку нужно уметь показать повторно
 * (её теряют в переписке). Риск ограничен — ссылка даёт ровно одно право:
 * вступить в одну доску с заранее заданной ролью. Защита — срок жизни,
 * лимит входов и отзыв в один клик.
 */

const inviteSelect = {
  id: true,
  boardId: true,
  token: true,
  role: true,
  group: { select: { id: true, name: true, color: true } },
  maxUses: true,
  useCount: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: publicUserSelect },
} satisfies Prisma.BoardInviteSelect;

type InviteRow = Prisma.BoardInviteGetPayload<{ select: typeof inviteSelect }>;

function inviteUrl(token: string): string {
  return `${env.APP_URL.replace(/\/+$/, '')}/invite/${token}`;
}

function mapInvite(invite: InviteRow): BoardInviteDto {
  return {
    id: invite.id,
    boardId: invite.boardId,
    url: inviteUrl(invite.token),
    role: invite.role,
    group: invite.group,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    createdBy: mapPublicUser(invite.createdBy),
    isExpired: invite.expiresAt.getTime() <= Date.now(),
    isExhausted: invite.maxUses !== null && invite.useCount >= invite.maxUses,
  };
}

/** Действующие ссылки доски. Видит только тот, кто имеет право звать людей. */
export async function listBoardInvites(
  user: RequestUser,
  context: BoardContext,
): Promise<BoardInviteDto[]> {
  assertCan(user, context, 'board.member.invite');

  const invites = await prisma.boardInvite.findMany({
    where: { boardId: context.board.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: inviteSelect,
  });

  return invites.filter((invite) => invite.maxUses === null || invite.useCount < invite.maxUses).map(mapInvite);
}

export async function createBoardInvite(
  user: RequestUser,
  context: BoardContext,
  input: CreateBoardInviteInput,
): Promise<BoardInviteDto> {
  assertCan(user, context, 'board.member.invite');

  // Ссылкой нельзя выдать роль выше собственной — иначе админ сделает себе
  // «второго владельца» в обход передачи прав.
  if (
    !canAssignBoardRole(context.membershipRole, null, input.role, {
      actorIsSuperAdmin: context.isSuperAdmin,
    })
  ) {
    throw new ForbiddenError('Нельзя выдать роль выше собственной');
  }

  // Группа обязана принадлежать этой же доске — иначе ссылка тянула бы
  // человека в чужую структуру.
  const groupId = input.groupId
    ? (
        await prisma.boardGroup.findFirst({
          where: { id: input.groupId, boardId: context.board.id },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const invite = await prisma.boardInvite.create({
    data: {
      boardId: context.board.id,
      token: randomBytes(24).toString('base64url'),
      role: input.role,
      groupId,
      createdById: user.id,
      maxUses: input.maxUses,
      expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    },
    select: inviteSelect,
  });

  return mapInvite(invite);
}

export async function revokeBoardInvite(
  user: RequestUser,
  context: BoardContext,
  inviteId: string,
): Promise<void> {
  assertCan(user, context, 'board.member.invite');

  const invite = await prisma.boardInvite.findFirst({
    where: { id: inviteId, boardId: context.board.id, revokedAt: null },
    select: { id: true },
  });
  if (!invite) throw new NotFoundError('Ссылка не найдена');

  await prisma.boardInvite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });
}

/** Что показать человеку до вступления: название доски, кто позвал и с какой ролью. */
export async function previewInvite(
  user: RequestUser,
  token: string,
): Promise<BoardInvitePreviewDto> {
  const invite = await loadUsableInvite(token);

  const [board, membership, memberCount] = await Promise.all([
    prisma.board.findUnique({
      where: { id: invite.boardId },
      select: { name: true, key: true, color: true, isArchived: true },
    }),
    prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: invite.boardId, userId: user.id } },
      select: { userId: true },
    }),
    prisma.boardMember.count({ where: { boardId: invite.boardId } }),
  ]);
  if (!board) throw new NotFoundError('Доска не найдена');

  return {
    boardName: board.name,
    boardKey: board.key,
    boardColor: board.color,
    role: invite.role,
    groupName: invite.group?.name ?? null,
    invitedBy: mapPublicUser(invite.createdBy),
    memberCount,
    alreadyMember: Boolean(membership),
  };
}

/** Вступление по ссылке. Возвращает ключ доски, чтобы сразу увести человека внутрь. */
export async function acceptInvite(
  user: RequestUser,
  token: string,
): Promise<{ boardKey: string; boardId: string; alreadyMember: boolean }> {
  const invite = await loadUsableInvite(token);

  const board = await prisma.board.findUnique({
    where: { id: invite.boardId },
    select: { id: true, key: true, name: true, isArchived: true },
  });
  if (!board) throw new NotFoundError('Доска не найдена');

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: user.id } },
    select: { userId: true },
  });
  if (existing) {
    return { boardKey: board.key, boardId: board.id, alreadyMember: true };
  }

  if (board.isArchived) throw new BadRequestError('Доска в архиве — вступить нельзя');

  // Счётчик увеличиваем условием в самом запросе: два человека, открывшие
  // последнюю ссылку одновременно, не пролезут оба.
  const claimed = await prisma.boardInvite.updateMany({
    where: {
      id: invite.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(invite.maxUses !== null ? { useCount: { lt: invite.maxUses } } : {}),
    },
    data: { useCount: { increment: 1 } },
  });
  if (claimed.count === 0) throw new BadRequestError('Ссылка больше не действует');

  await prisma.$transaction(async (tx) => {
    await tx.boardMember.create({
      data: {
        boardId: board.id,
        userId: user.id,
        role: invite.role,
        addedById: invite.createdById,
      },
    });
    if (invite.groupId) {
      // Группа могла исчезнуть, пока ссылка ходила по чатам, — тогда просто
      // пускаем человека на доску без неё.
      const group = await tx.boardGroup.findFirst({
        where: { id: invite.groupId, boardId: board.id },
        select: { id: true },
      });
      if (group) {
        await tx.boardGroupMember.create({ data: { groupId: group.id, userId: user.id } });
      }
    }
    await recordActivity(tx, {
      boardId: board.id,
      actorId: user.id,
      type: ActivityType.MEMBER_ADDED,
      payload: { userId: user.id, role: invite.role, viaInvite: true },
    });
  });

  await dispatchNotification({
    type: NotificationType.BOARD_MEMBER_JOINED,
    recipientIds: [invite.createdById],
    actorId: user.id,
    boardId: board.id,
    payload: { boardName: board.name, actorName: user.displayName, role: roleLabel(invite.role) },
  });

  await publishRealtime({
    room: rooms.board(board.id),
    event: SOCKET_EVENTS.BOARD_MEMBERS_CHANGED,
    data: { boardId: board.id },
  });

  return { boardKey: board.key, boardId: board.id, alreadyMember: false };
}

async function loadUsableInvite(
  token: string,
): Promise<InviteRow & { createdById: string; groupId: string | null }> {
  const invite = await prisma.boardInvite.findUnique({
    where: { token },
    select: { ...inviteSelect, createdById: true, groupId: true },
  });
  // Одинаковый текст для «нет такой ссылки» и «ссылка мертва»: наличие доски
  // по чужому токену подтверждать не нужно.
  if (!invite || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError('Ссылка недействительна или истекла', 'INVITE_INVALID');
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    throw new NotFoundError('Ссылка недействительна или истекла', 'INVITE_INVALID');
  }
  return invite;
}

const ROLE_LABELS: Record<BoardRole, string> = {
  [BoardRole.OWNER]: 'Владелец',
  [BoardRole.ADMIN]: 'Администратор',
  [BoardRole.MEMBER]: 'Участник',
  [BoardRole.VIEWER]: 'Наблюдатель',
};

function roleLabel(role: BoardRole): string {
  return ROLE_LABELS[role];
}
