import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ColumnKey,
  GlobalRole,
  SecurityEventType,
  listUsersSchema,
  setGlobalRoleSchema,
  setUserActiveSchema,
  taskFiltersSchema,
} from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { mapPublicUser, mapTaskCard, publicUserSelect, taskCardSelect } from '../../lib/mappers.js';
import {
  invalidateAccessTokens,
  recordSecurityEvent,
  revokeAllSessions,
} from '../auth/service.js';
import { requestMeta } from '../../lib/http.js';
import { buildTaskWhere } from '../tasks/service.js';

/**
 * Админка суперадмина: он видит все доски и все задачи, управляет людьми
 * и имеет глобальный «банк задач» — бэклог по всем доскам сразу.
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireSuperAdmin);

  app.get('/stats', async (_request, reply) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

    const [users, activeUsers, boards, tasks, overdue, backlog, doneWeek, createdWeek, linkedBots] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.board.count({ where: { isArchived: false } }),
        prisma.task.count({ where: { archivedAt: null } }),
        prisma.task.count({
          where: { archivedAt: null, columnKey: { not: ColumnKey.DONE }, dueDate: { lt: now } },
        }),
        prisma.task.count({ where: { archivedAt: null, isBacklog: true } }),
        prisma.task.count({ where: { completedAt: { gte: weekAgo } } }),
        prisma.task.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.user.count({ where: { botChatId: { not: null }, botBlocked: false } }),
      ]);

    return reply.send({
      stats: {
        users,
        activeUsers,
        boards,
        tasks,
        overdue,
        backlog,
        doneWeek,
        createdWeek,
        linkedBots,
      },
    });
  });

  app.get('/users', async (request, reply) => {
    const query = listUsersSchema.parse(request.query ?? {});
    const users = await prisma.user.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search, mode: 'insensitive' } },
                { tgUsername: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        ...publicUserSelect,
        globalRole: true,
        profileCompleted: true,
        botChatId: true,
        botBlocked: true,
        lastSeenAt: true,
        createdAt: true,
        _count: { select: { assignedTasks: true, memberships: true } },
      },
    });

    return reply.send({
      items: users.map((user) => ({
        ...mapPublicUser(user),
        globalRole: user.globalRole,
        profileCompleted: user.profileCompleted,
        botLinked: user.botChatId !== null,
        botBlocked: user.botBlocked,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        assignedTasks: user._count.assignedTasks,
        boards: user._count.memberships,
      })),
    });
  });

  app.patch('/users/:userId/role', async (request, reply) => {
    const actor = requireUser(request);
    const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(request.params);
    const { role } = setGlobalRoleSchema.parse(request.body);

    if (userId === actor.id) {
      throw new ForbiddenError('Нельзя менять собственную глобальную роль');
    }

    await prisma.user.update({ where: { id: userId }, data: { globalRole: role } });
    // Роль зашита в access-токен — обесцениваем выданные токены. Сессии
    // остаются живыми: человек не заметит ничего, кроме новых прав.
    await invalidateAccessTokens(userId);
    await recordSecurityEvent(
      userId,
      SecurityEventType.GLOBAL_ROLE_CHANGED,
      requestMeta(request),
      { role, by: actor.id },
    );

    return reply.send({ success: true });
  });

  app.patch('/users/:userId/active', async (request, reply) => {
    const actor = requireUser(request);
    const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(request.params);
    const input = setUserActiveSchema.parse(request.body);

    if (userId === actor.id) throw new ForbiddenError('Нельзя отключить собственную учётную запись');

    if (!input.isActive && input.reassignToUserId) {
      const target = await prisma.user.findUnique({
        where: { id: input.reassignToUserId },
        select: { id: true, isActive: true },
      });
      if (!target?.isActive) throw new BadRequestError('Некорректный получатель задач');

      // Переназначаем только там, где новый исполнитель тоже состоит в доске.
      const boards = await prisma.boardMember.findMany({
        where: { userId: input.reassignToUserId },
        select: { boardId: true },
      });
      await prisma.task.updateMany({
        where: {
          assigneeId: userId,
          archivedAt: null,
          columnKey: { not: ColumnKey.DONE },
          boardId: { in: boards.map((b) => b.boardId) },
        },
        data: { assigneeId: input.reassignToUserId },
      });
    }

    await prisma.user.update({ where: { id: userId }, data: { isActive: input.isActive } });
    if (!input.isActive) await revokeAllSessions(userId);

    await recordSecurityEvent(
      userId,
      input.isActive ? SecurityEventType.USER_REACTIVATED : SecurityEventType.USER_DEACTIVATED,
      requestMeta(request),
      { by: actor.id, reassignTo: input.reassignToUserId ?? null },
    );

    return reply.send({ success: true });
  });

  app.get('/boards', async (_request, reply) => {
    const boards = await prisma.board.findMany({
      orderBy: [{ isArchived: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        key: true,
        name: true,
        color: true,
        isArchived: true,
        createdAt: true,
        owner: { select: publicUserSelect },
        _count: { select: { members: true, tasks: true } },
      },
    });

    return reply.send({
      items: boards.map((board) => ({
        id: board.id,
        key: board.key,
        name: board.name,
        color: board.color,
        isArchived: board.isArchived,
        createdAt: board.createdAt.toISOString(),
        owner: mapPublicUser(board.owner),
        members: board._count.members,
        tasks: board._count.tasks,
      })),
    });
  });

  /**
   * Глобальный банк задач: бэклог всех досок в одном окне.
   * Отсюда админ раздаёт работу, не переключаясь между досками.
   */
  app.get('/backlog', async (request, reply) => {
    const filters = taskFiltersSchema.parse(request.query ?? {});
    const { boardId } = z
      .object({ boardId: z.string().min(1).max(40).optional() })
      .parse(request.query ?? {});

    const where = boardId
      ? await buildTaskWhere(boardId, { ...filters, onlyBacklog: true })
      : {
          archivedAt: null,
          isBacklog: true,
          ...(filters.search && filters.search.length >= 2
            ? { searchText: { contains: filters.search.toLowerCase() } }
            : {}),
          ...(filters.assigneeIds?.length ? { assigneeId: { in: filters.assigneeIds } } : {}),
          ...(filters.priorities?.length ? { priority: { in: filters.priorities } } : {}),
          ...(filters.types?.length ? { type: { in: filters.types } } : {}),
        };

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: taskCardSelect,
    });

    const hasMore = tasks.length > filters.limit;
    const page = hasMore ? tasks.slice(0, filters.limit) : tasks;

    return reply.send({
      items: page.map(mapTaskCard),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  /** Журнал безопасности: входы, отзывы сессий, смены ролей. */
  app.get('/security-events', async (request, reply) => {
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        userId: z.string().min(1).max(40).optional(),
      })
      .parse(request.query ?? {});

    const events = await prisma.securityEvent.findMany({
      where: query.userId ? { userId: query.userId } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        ip: true,
        userAgent: true,
        payload: true,
        createdAt: true,
        user: { select: publicUserSelect },
      },
    });

    const hasMore = events.length > query.limit;
    const page = hasMore ? events.slice(0, query.limit) : events;

    return reply.send({
      items: page.map((event) => ({
        id: event.id,
        type: event.type,
        ip: event.ip,
        userAgent: event.userAgent,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
        user: event.user ? mapPublicUser(event.user) : null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  /** Состояние очереди уведомлений — чтобы «бот молчит» диагностировалось за минуту. */
  app.get('/queues', async (_request, reply) => {
    const { telegramQueue } = await import('../../queue/index.js');
    const counts = await telegramQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return reply.send({ telegram: counts });
  });

  app.get('/roles', async (_request, reply) => {
    return reply.send({ roles: Object.values(GlobalRole) });
  });
}
