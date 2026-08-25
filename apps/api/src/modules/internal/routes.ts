import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ColumnKey,
  columnKeySchema,
  dayRangeInTimeZone,
  docFromText,
  mergeNotificationPreferences,
  updateNotificationPreferencesSchema,
  type CreateCommentInput,
} from '@kaif/shared';
import { env } from '../../config/env.js';
import { timingSafeEqual } from '../../lib/crypto.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mapTaskCard, taskCardSelect } from '../../lib/mappers.js';
import { loadTaskContext, type RequestUser } from '../../lib/rbac.js';
import {
  confirmLoginCode,
  describeLoginRequest,
  revokeAllSessions,
  upsertTelegramUser,
} from '../auth/service.js';
import type { TelegramUserData } from '../../lib/telegram-auth.js';
import { createComment } from '../comments/service.js';
import { moveTask } from '../tasks/move.js';
import { getTaskDetail } from '../tasks/service.js';

/**
 * Служебный API для бота.
 *
 * Бот — тонкий клиент: он не пишет в базу напрямую, а ходит сюда.
 * Благодаря этому вся бизнес-логика (участники, уведомления, история,
 * обязательные причины) живёт в одном месте и не дублируется.
 *
 * Доступ — по общему секрету из окружения, сверяется за постоянное время.
 */
export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const provided = request.headers['x-internal-secret'];
    if (typeof provided !== 'string' || !timingSafeEqual(provided, env.INTERNAL_API_SECRET)) {
      throw new ForbiddenError('Недействительный служебный ключ', 'BAD_INTERNAL_SECRET');
    }
  });

  const telegramUserSchema = z.object({
    telegramId: z.union([z.string(), z.number()]),
    firstName: z.string().max(128).nullable().optional(),
    lastName: z.string().max(128).nullable().optional(),
    username: z.string().max(64).nullable().optional(),
    photoUrl: z.string().url().max(512).nullable().optional(),
    languageCode: z.string().max(8).nullable().optional(),
    chatId: z.union([z.string(), z.number()]),
  });

  const toTelegramData = (body: {
    telegramId: string | number;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
    languageCode?: string | null;
  }): TelegramUserData => ({
    telegramId: BigInt(body.telegramId),
    firstName: body.firstName ?? null,
    lastName: body.lastName ?? null,
    username: body.username ?? null,
    photoUrl: body.photoUrl ?? null,
    languageCode: body.languageCode ?? null,
    authDate: new Date(),
    hash: '',
  });

  /**
   * Пользователь нажал /start.
   *
   * Если пришёл код входа — вход НЕ подтверждается сразу: возвращаем боту
   * описание устройства, которое просится внутрь. Решение принимает человек
   * отдельной кнопкой, иначе достаточно прислать ему ссылку на чужой код,
   * чтобы получить сессию под его именем.
   */
  app.post('/telegram/link', async (request, reply) => {
    const body = telegramUserSchema
      .extend({ code: z.string().max(128).optional() })
      .parse(request.body);

    const data = toTelegramData(body);
    const chatId = BigInt(body.chatId);
    const user = await upsertTelegramUser(data, chatId);

    let pendingLogin = null;
    let loginError: string | null = null;

    if (body.code) {
      const result = await describeLoginRequest(body.code);
      if (result.ok) {
        pendingLogin = {
          verificationCode: result.pending.verificationCode,
          deviceLabel: result.pending.deviceLabel,
          ip: result.pending.ip,
          expiresAt: result.pending.expiresAt.toISOString(),
        };
      } else {
        loginError = result.reason;
      }
    }

    return reply.send({
      user: {
        id: user.id,
        displayName: user.displayName,
        profileCompleted: user.profileCompleted,
        globalRole: user.globalRole,
      },
      pendingLogin,
      loginError,
    });
  });

  /** Человек нажал «Подтвердить» или «Это не я» под запросом входа. */
  app.post('/telegram/login-confirm', async (request, reply) => {
    const body = telegramUserSchema
      .extend({ code: z.string().max(128), approve: z.boolean() })
      .parse(request.body);

    const result = await confirmLoginCode(
      body.code,
      toTelegramData(body),
      BigInt(body.chatId),
      body.approve,
    );

    return reply.send({ approved: result.approved, reason: result.reason ?? null });
  });

  /** Пользователь заблокировал бота — прекращаем попытки писать ему. */
  app.post('/telegram/blocked', async (request, reply) => {
    const { chatId, blocked } = z
      .object({ chatId: z.union([z.string(), z.number()]), blocked: z.boolean().default(true) })
      .parse(request.body);
    await prisma.user.updateMany({
      where: { botChatId: BigInt(chatId) },
      data: { botBlocked: blocked },
    });
    return reply.send({ success: true });
  });

  app.get('/telegram/me', async (request, reply) => {
    const { chatId } = z.object({ chatId: z.union([z.string(), z.number()]) }).parse(request.query);
    const user = await findUserByChat(chatId);
    return reply.send({
      user: {
        id: user.id,
        displayName: user.displayName,
        profileCompleted: user.profileCompleted,
        globalRole: user.globalRole,
        timezone: user.timezone,
      },
    });
  });

  /** Список задач для команд /tasks и /today. */
  app.get('/telegram/tasks', async (request, reply) => {
    const { chatId, scope, limit } = z
      .object({
        chatId: z.union([z.string(), z.number()]),
        scope: z.enum(['active', 'today', 'overdue', 'testing']).default('active'),
        limit: z.coerce.number().int().min(1).max(20).default(10),
      })
      .parse(request.query);

    const user = await findUserByChat(chatId);
    const now = new Date();
    const { end: endOfDay } = dayRangeInTimeZone(now, user.timezone);

    const where = (() => {
      switch (scope) {
        case 'today':
          return {
            assigneeId: user.id,
            archivedAt: null,
            columnKey: { not: ColumnKey.DONE },
            dueDate: { lt: endOfDay },
          };
        case 'overdue':
          return {
            assigneeId: user.id,
            archivedAt: null,
            columnKey: { not: ColumnKey.DONE },
            dueDate: { lt: now },
          };
        case 'testing':
          return { testerId: user.id, archivedAt: null, columnKey: ColumnKey.QA };
        default:
          return { assigneeId: user.id, archivedAt: null, columnKey: { not: ColumnKey.DONE } };
      }
    })();

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      take: limit,
      select: { ...taskCardSelect, board: { select: { name: true, key: true } } },
    });

    return reply.send({
      items: tasks.map((task) => ({
        ...mapTaskCard(task),
        boardName: task.board.name,
      })),
    });
  });

  /** Комментарий из Telegram (ответ на уведомление). */
  app.post('/telegram/comment', async (request, reply) => {
    const { chatId, taskId, text } = z
      .object({
        chatId: z.union([z.string(), z.number()]),
        taskId: z.string().min(1).max(40),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(request.body);

    const user = await findUserByChat(chatId);
    const requestUser = toRequestUser(user);
    const context = await loadTaskContext(requestUser, taskId);

    const comment = await createComment(requestUser, context, {
      body: docFromText(text) as CreateCommentInput['body'],
    });

    return reply.send({ commentId: comment.id, taskKey: context.task.key });
  });

  /** Быстрая смена статуса из Telegram. Права и правила проверяются как обычно. */
  app.post('/telegram/move', async (request, reply) => {
    const { chatId, taskId, toColumn, reason } = z
      .object({
        chatId: z.union([z.string(), z.number()]),
        taskId: z.string().min(1).max(40),
        toColumn: columnKeySchema,
        reason: z.string().trim().max(2000).optional(),
      })
      .parse(request.body);

    const user = await findUserByChat(chatId);
    const requestUser = toRequestUser(user);
    const context = await loadTaskContext(requestUser, taskId);

    const task = await moveTask(requestUser, context, {
      toColumn,
      ...(reason ? { reason } : {}),
    });

    return reply.send({ task: { key: task.key, columnKey: task.columnKey } });
  });

  /** Настройки уведомлений — команда /settings в боте. */
  app.get('/telegram/prefs', async (request, reply) => {
    const { chatId } = z.object({ chatId: z.union([z.string(), z.number()]) }).parse(request.query);
    const user = await findUserByChat(chatId);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    return reply.send({ preferences: mergeNotificationPreferences(row?.notificationPrefs) });
  });

  app.post('/telegram/prefs', async (request, reply) => {
    const { chatId, preferences } = z
      .object({
        chatId: z.union([z.string(), z.number()]),
        preferences: updateNotificationPreferencesSchema,
      })
      .parse(request.body);

    const user = await findUserByChat(chatId);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    const merged = mergeNotificationPreferences({
      ...mergeNotificationPreferences(row?.notificationPrefs),
      ...preferences,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { notificationPrefs: merged as object },
    });
    return reply.send({ preferences: merged });
  });

  /** Выход со всех устройств прямо из Telegram — на случай потери телефона. */
  app.post('/telegram/logout', async (request, reply) => {
    const { chatId } = z.object({ chatId: z.union([z.string(), z.number()]) }).parse(request.body);
    const user = await findUserByChat(chatId);
    await revokeAllSessions(user.id);
    return reply.send({ success: true });
  });

  app.get('/telegram/task/:taskId', async (request, reply) => {
    const { taskId } = z.object({ taskId: z.string().min(1).max(40) }).parse(request.params);
    const { chatId } = z.object({ chatId: z.union([z.string(), z.number()]) }).parse(request.query);
    const user = await findUserByChat(chatId);
    const task = await getTaskDetail(toRequestUser(user), taskId);
    return reply.send({ task });
  });
}

async function findUserByChat(chatId: string | number) {
  const user = await prisma.user.findFirst({
    where: { botChatId: BigInt(chatId) },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      globalRole: true,
      profileCompleted: true,
      timezone: true,
      locale: true,
      isActive: true,
    },
  });
  if (!user) throw new NotFoundError('Аккаунт не привязан', 'TELEGRAM_NOT_LINKED');
  if (!user.isActive) throw new ForbiddenError('Учётная запись отключена', 'USER_INACTIVE');
  return user;
}

function toRequestUser(user: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  globalRole: RequestUser['globalRole'];
  profileCompleted: boolean;
  timezone: string;
  locale: string;
}): RequestUser {
  return {
    id: user.id,
    // Действия из бота не привязаны к веб-сессии.
    sessionId: 'telegram-bot',
    globalRole: user.globalRole,
    profileCompleted: user.profileCompleted,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    locale: user.locale,
  };
}
