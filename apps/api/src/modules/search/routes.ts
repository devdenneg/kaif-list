import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { LIMITS } from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { heavyRateLimit } from '../../plugins/security.js';
import { prisma } from '../../lib/prisma.js';
import { mapPublicUser, mapTaskCard, publicUserSelect, taskCardSelect } from '../../lib/mappers.js';
import { accessibleBoardIds } from '../../lib/rbac.js';

/**
 * Кого можно найти по имени.
 *
 * Только тех, с кем есть общая доска. Исключений нет ни для кого, включая
 * суперадмина: палитра — рабочий инструмент, а не справочник компании.
 * Раньше суперадмин видел здесь вообще всех, кто когда-либо завёл аккаунт, —
 * то есть состав организации утекал в обычный поиск по задачам.
 * Полный список людей живёт в админке, и это отдельный экран с отдельным правом.
 */
export function peopleSearchWhere(userId: string, query: string): Prisma.UserWhereInput {
  return {
    isActive: true,
    OR: [
      { displayName: { contains: query, mode: 'insensitive' } },
      { tgUsername: { contains: query, mode: 'insensitive' } },
    ],
    memberships: { some: { board: { members: { some: { userId } } } } },
  };
}

/**
 * Сквозной поиск для командной палитры: задачи, доски, люди.
 * Ищем только там, куда у пользователя есть доступ.
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireProfile);

  app.get('/', heavyRateLimit, async (request, reply) => {
    const user = requireUser(request);
    const { q, limit } = z
      .object({
        q: z.string().trim().min(LIMITS.search.minQuery).max(LIMITS.search.max),
        limit: z.coerce.number().int().min(1).max(30).default(10),
      })
      .parse(request.query ?? {});

    const boardIds = await accessibleBoardIds(user);
    const scope = boardIds === 'ALL' ? {} : { boardId: { in: boardIds } };
    const needle = q.toLowerCase();

    // Точное совпадение по ключу задачи — самый частый сценарий («открой OPS-128»).
    const keyMatch = /^[a-zA-Z][a-zA-Z0-9]{1,7}-\d{1,7}$/.test(q) ? q.toUpperCase() : null;

    const [tasks, boards, users] = await Promise.all([
      prisma.task.findMany({
        where: {
          ...scope,
          archivedAt: null,
          ...(keyMatch ? { key: keyMatch } : { searchText: { contains: needle } }),
        },
        orderBy: [{ lastActivityAt: 'desc' }],
        take: limit,
        select: taskCardSelect,
      }),
      prisma.board.findMany({
        where: {
          ...(boardIds === 'ALL' ? {} : { id: { in: boardIds } }),
          isArchived: false,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { key: { contains: q.toUpperCase() } },
          ],
        },
        take: 5,
        select: { id: true, key: true, name: true, color: true },
      }),
      prisma.user.findMany({
        where: peopleSearchWhere(user.id, q),
        take: 5,
        select: publicUserSelect,
      }),
    ]);

    return reply.send({
      tasks: tasks.map(mapTaskCard),
      boards,
      users: users.map(mapPublicUser),
    });
  });
}
