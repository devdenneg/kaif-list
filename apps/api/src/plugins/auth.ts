import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GlobalRole } from '@kaif/shared';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../lib/prisma.js';
import { isSessionRevoked } from '../lib/redis.js';
import type { RequestUser } from '../lib/rbac.js';

/**
 * Авторизация запроса.
 *
 * Access-токен короткоживущий, но этого мало: при каждом запросе сверяем
 * версию токенов и активность пользователя, а также проверяем, не отозвана ли
 * сессия. Так «выйти на всех устройствах» и блокировка сотрудника срабатывают
 * мгновенно, а не через 15 минут.
 */

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

async function resolveUser(request: FastifyRequest): Promise<RequestUser> {
  const token = extractToken(request);
  if (!token) throw new UnauthorizedError('Требуется авторизация', 'NO_TOKEN');

  const payload = await verifyAccessToken(token);

  if (await isSessionRevoked(payload.sid)) {
    throw new UnauthorizedError('Сессия завершена', 'SESSION_REVOKED');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      globalRole: true,
      profileCompleted: true,
      isActive: true,
      tokenVersion: true,
      displayName: true,
      avatarUrl: true,
      timezone: true,
      locale: true,
    },
  });

  if (!user) throw new UnauthorizedError('Пользователь не найден', 'USER_NOT_FOUND');
  if (!user.isActive) throw new ForbiddenError('Учётная запись отключена', 'USER_INACTIVE');
  if (user.tokenVersion !== payload.ver) {
    throw new UnauthorizedError('Сессия устарела, войдите заново', 'TOKEN_STALE');
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Сессия завершена', 'SESSION_REVOKED');
  }

  return {
    id: user.id,
    sessionId: payload.sid,
    globalRole: user.globalRole,
    profileCompleted: user.profileCompleted,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    locale: user.locale,
  };
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('currentUser', null);

  app.decorate('authenticate', async function authenticate(request: FastifyRequest) {
    request.currentUser = await resolveUser(request);
  });

  app.decorate('requireProfile', async function requireProfile(request: FastifyRequest) {
    const user = request.currentUser ?? (await resolveUser(request));
    request.currentUser = user;
    if (!user.profileCompleted) {
      throw new ForbiddenError(
        'Сначала завершите настройку профиля: укажите имя и аватар',
        'PROFILE_INCOMPLETE',
      );
    }
  });

  app.decorate('requireSuperAdmin', async function requireSuperAdmin(request: FastifyRequest) {
    const user = request.currentUser ?? (await resolveUser(request));
    request.currentUser = user;
    if (user.globalRole !== GlobalRole.SUPERADMIN) {
      throw new ForbiddenError('Доступ только для администраторов', 'SUPERADMIN_ONLY');
    }
  });

  // Обновляем «был в сети» не чаще раза в 5 минут, чтобы не долбить БД.
  const lastSeenCache = new Map<string, number>();
  const LAST_SEEN_INTERVAL = 5 * 60 * 1000;

  app.addHook('onResponse', async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.currentUser;
    if (!user) return;
    const now = Date.now();
    const previous = lastSeenCache.get(user.id) ?? 0;
    if (now - previous < LAST_SEEN_INTERVAL) return;
    lastSeenCache.set(user.id, now);
    if (lastSeenCache.size > 5000) lastSeenCache.clear();
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date(now) },
      });
    } catch {
      // Отметка «был в сети» не критична — молча игнорируем сбой.
    }
  });
}

/**
 * Мягкая авторизация: пользователь определяется, если валидный токен есть,
 * иначе возвращается null. Нужна для файловых роутов, где доступ может быть
 * выдан подписанной ссылкой.
 */
export async function tryResolveUser(request: FastifyRequest): Promise<RequestUser | null> {
  if (!request.headers.authorization) return null;
  try {
    const user = await resolveUser(request);
    request.currentUser = user;
    return user;
  } catch {
    return null;
  }
}

/** Хелпер: гарантированно получить пользователя из запроса. */
export function requireUser(request: FastifyRequest): RequestUser {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();
  return user;
}
