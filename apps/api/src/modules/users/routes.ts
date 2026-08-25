import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ColumnKey,
  LIMITS,
  listUsersSchema,
  mergeNotificationPreferences,
  updateNotificationPreferencesSchema,
  updateProfileSchema,
} from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../lib/errors.js';
import { sanitizePlainText } from '../../lib/sanitize.js';
import { deleteAvatar, storeAvatar } from '../../lib/files.js';
import { mapPublicUser, mapTaskCard, publicUserSelect, taskCardSelect } from '../../lib/mappers.js';
import { accessibleBoardIds, loadBoardContext } from '../../lib/rbac.js';
import { readMultipartFile } from '../attachments/service.js';
import { getCurrentUser } from './service.js';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * Справочник людей в пределах одной доски — для выбора исполнителя
   * и упоминаний.
   *
   * `boardId` обязателен намеренно: общий список всех, кто зарегистрирован
   * в системе, наружу не отдаётся никому, включая суперадмина (у него для
   * этого есть админка). Иначе любой участник любой доски видел бы всю
   * компанию целиком, а состав доски перестал бы быть решением её владельца.
   */
  app.get('/', async (request, reply) => {
    const user = requireUser(request);
    const query = listUsersSchema.parse(request.query ?? {});
    if (!query.boardId) throw new BadRequestError('Укажите доску');

    // Смотреть состав доски может только тот, кто сам на ней есть.
    await loadBoardContext(user, query.boardId);

    const users = await prisma.user.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        memberships: { some: { boardId: query.boardId } },
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search, mode: 'insensitive' } },
                { tgUsername: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: publicUserSelect,
    });

    return reply.send({ items: users.map(mapPublicUser), nextCursor: null });
  });

  app.patch('/me', async (request, reply) => {
    const user = requireUser(request);
    const input = updateProfileSchema.parse(request.body);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: sanitizePlainText(input.displayName, 48) }
          : {}),
        ...(input.avatarUrl !== undefined
          ? { avatarUrl: input.avatarUrl, avatarCustom: input.avatarUrl !== null }
          : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone.slice(0, 64) } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
      },
    });

    return reply.send({ user: await getCurrentUser(user.id) });
  });

  /** Загрузка аватара: кроп в квадрат, webp, метаданные вырезаются. */
  app.post('/me/avatar', async (request, reply) => {
    const user = requireUser(request);
    const file = await request.file();
    if (!file) throw new BadRequestError('Файл не передан');

    const buffer = await readMultipartFile(file.file, LIMITS.avatar.maxBytes);
    if (file.file.truncated) throw new BadRequestError('Аватар слишком большой');

    const storedName = await storeAvatar(buffer, file.mimetype);
    const avatarUrl = `/api/files/avatars/${storedName}`;

    const previous = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarUrl: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl, avatarCustom: true },
    });

    // Старый файл больше не нужен — не копим мусор на диске.
    const previousName = previous?.avatarUrl?.split('/').pop();
    if (previousName && previous?.avatarUrl?.startsWith('/api/files/avatars/')) {
      await deleteAvatar(previousName);
    }

    return reply.send({ avatarUrl, user: await getCurrentUser(user.id) });
  });

  app.get('/me/notifications-settings', async (request, reply) => {
    const user = requireUser(request);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    return reply.send({ preferences: mergeNotificationPreferences(row?.notificationPrefs) });
  });

  app.patch('/me/notifications-settings', async (request, reply) => {
    const user = requireUser(request);
    const input = updateNotificationPreferencesSchema.parse(request.body);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    const merged = mergeNotificationPreferences({
      ...mergeNotificationPreferences(row?.notificationPrefs),
      ...input,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { notificationPrefs: merged as object },
    });
    return reply.send({ preferences: merged });
  });

  /** Мои задачи по всем доскам — отдельный сквозной экран. */
  app.get('/me/tasks', { preHandler: app.requireProfile }, async (request, reply) => {
    const user = requireUser(request);
    const query = z
      .object({
        scope: z.enum(['active', 'today', 'overdue', 'reported', 'testing', 'done']).default('active'),
        search: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(request.query ?? {});

    const boardIds = await accessibleBoardIds(user);
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const base = {
      archivedAt: null,
      ...(boardIds === 'ALL' ? {} : { boardId: { in: boardIds } }),
      // searchText уже содержит ключ, заголовок и описание в нижнем регистре.
      ...(query.search && query.search.length >= 2
        ? { searchText: { contains: query.search.toLowerCase() } }
        : {}),
    };

    const where = (() => {
      switch (query.scope) {
        case 'today':
          return {
            ...base,
            assigneeId: user.id,
            columnKey: { not: ColumnKey.DONE },
            dueDate: { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86_400_000) },
          };
        case 'overdue':
          return {
            ...base,
            assigneeId: user.id,
            columnKey: { not: ColumnKey.DONE },
            dueDate: { lt: now },
          };
        case 'reported':
          return { ...base, reporterId: user.id, columnKey: { not: ColumnKey.DONE } };
        case 'testing':
          return { ...base, testerId: user.id, columnKey: { in: [ColumnKey.QA] } };
        case 'done':
          return { ...base, assigneeId: user.id, columnKey: ColumnKey.DONE };
        default:
          return { ...base, assigneeId: user.id, columnKey: { not: ColumnKey.DONE } };
      }
    })();

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
      take: query.limit,
      select: taskCardSelect,
    });

    return reply.send({ items: tasks.map(mapTaskCard) });
  });
}
