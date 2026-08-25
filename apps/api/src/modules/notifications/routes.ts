import type { FastifyInstance } from 'fastify';
import {
  SOCKET_EVENTS,
  listNotificationsSchema,
  markNotificationsReadSchema,
  rooms,
} from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { prisma } from '../../lib/prisma.js';
import { mapNotification, notificationSelect } from '../../lib/mappers.js';
import { publishRealtime } from '../../realtime/bridge.js';

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request, reply) => {
    const user = requireUser(request);
    const query = listNotificationsSchema.parse(request.query ?? {});

    const rows = await prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(query.onlyUnread ? { readAt: null } : {}),
        ...(query.types?.length ? { type: { in: query.types } } : {}),
        ...(query.boardId ? { boardId: query.boardId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: notificationSelect,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return reply.send({
      items: page.map(mapNotification),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  app.get('/unread-count', async (request, reply) => {
    const user = requireUser(request);
    const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
    return reply.send({ unread });
  });

  app.post('/read', async (request, reply) => {
    const user = requireUser(request);
    const input = markNotificationsReadSchema.parse(request.body ?? {});

    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(input.ids?.length ? { id: { in: input.ids } } : {}),
        ...(input.boardId ? { boardId: input.boardId } : {}),
      },
      data: { readAt: new Date() },
    });

    const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
    await publishRealtime({
      room: rooms.user(user.id),
      event: SOCKET_EVENTS.NOTIFICATION_COUNT,
      data: { unread },
    });

    return reply.send({ unread });
  });
}
