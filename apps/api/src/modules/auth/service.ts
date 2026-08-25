import {
  AuthProvider,
  DEFAULT_NOTIFICATION_PREFERENCES,
  GlobalRole,
  LoginTokenStatus,
  SOCKET_EVENTS,
  SecurityEventType,
  TTL,
  rooms,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import {
  refreshTokenTtlSeconds,
  signAccessToken,
  type AccessTokenPayload,
} from '../../lib/tokens.js';
import { markSessionRevoked } from '../../lib/redis.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import { buildDisplayName, type TelegramUserData } from '../../lib/telegram-auth.js';
import { downloadAndStoreAvatar } from '../../lib/files.js';
import { notifySecurity } from '../../services/notify.js';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceLabel?: string | null;
}

export async function recordSecurityEvent(
  userId: string | null,
  type: SecurityEventType,
  meta: RequestMeta,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId,
        type,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        payload: payload as object,
      },
    });
  } catch (error) {
    logger.error({ err: error, type }, 'Не удалось записать событие безопасности');
  }
}

// ───────────────────────── Вход по одноразовому коду ────────────────────────

export interface LoginCode {
  code: string;
  deepLink: string;
  botUsername: string;
  expiresAt: Date;
}

/**
 * Выдаёт одноразовый код входа. В БД хранится только хеш —
 * даже дамп базы не позволит войти чужим кодом.
 */
export async function createLoginCode(meta: RequestMeta): Promise<LoginCode> {
  const code = randomToken(24);
  const expiresAt = new Date(Date.now() + TTL.loginCodeSeconds * 1000);

  await prisma.loginToken.create({
    data: {
      tokenHash: sha256Hex(code),
      status: LoginTokenStatus.PENDING,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      deviceLabel: meta.deviceLabel?.slice(0, 120) ?? null,
      expiresAt,
    },
  });

  await recordSecurityEvent(null, SecurityEventType.LOGIN_CODE_ISSUED, meta);

  return {
    code,
    deepLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    expiresAt,
  };
}

export async function getLoginCodeStatus(code: string): Promise<LoginTokenStatus> {
  const token = await prisma.loginToken.findUnique({
    where: { tokenHash: sha256Hex(code) },
    select: { status: true, expiresAt: true },
  });
  if (!token) return LoginTokenStatus.EXPIRED;
  if (token.status === LoginTokenStatus.PENDING && token.expiresAt.getTime() < Date.now()) {
    return LoginTokenStatus.EXPIRED;
  }
  return token.status;
}

/**
 * Подтверждение кода ботом: бот достоверно знает telegram_id отправителя,
 * потому что сообщение пришло от серверов Telegram.
 */
export async function approveLoginCode(
  code: string,
  telegramUser: TelegramUserData,
  chatId: bigint,
): Promise<{ approved: boolean; reason?: string; userId?: string }> {
  const tokenHash = sha256Hex(code);
  const token = await prisma.loginToken.findUnique({ where: { tokenHash } });

  if (!token) return { approved: false, reason: 'NOT_FOUND' };
  if (token.status !== LoginTokenStatus.PENDING) return { approved: false, reason: 'ALREADY_USED' };
  if (token.expiresAt.getTime() < Date.now()) {
    await prisma.loginToken.update({
      where: { tokenHash },
      data: { status: LoginTokenStatus.EXPIRED },
    });
    return { approved: false, reason: 'EXPIRED' };
  }

  const user = await upsertTelegramUser(telegramUser, chatId);

  await prisma.loginToken.update({
    where: { tokenHash },
    data: { status: LoginTokenStatus.APPROVED, userId: user.id, approvedAt: new Date() },
  });

  await recordSecurityEvent(
    user.id,
    SecurityEventType.LOGIN_CODE_APPROVED,
    { ip: token.ip, userAgent: token.userAgent },
    { via: 'bot' },
  );

  return { approved: true, userId: user.id };
}

/** Обмен подтверждённого кода на пару токенов. Код одноразовый. */
export async function consumeLoginCode(code: string, meta: RequestMeta) {
  const tokenHash = sha256Hex(code);

  const token = await prisma.loginToken.findUnique({ where: { tokenHash } });
  if (!token) throw new UnauthorizedError('Код входа не найден', 'LOGIN_CODE_NOT_FOUND');
  if (token.status === LoginTokenStatus.CONSUMED) {
    throw new UnauthorizedError('Код уже использован', 'LOGIN_CODE_USED');
  }
  if (token.status !== LoginTokenStatus.APPROVED || !token.userId) {
    throw new UnauthorizedError('Код ещё не подтверждён в Telegram', 'LOGIN_CODE_PENDING');
  }
  if (token.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Срок действия кода истёк', 'LOGIN_CODE_EXPIRED');
  }

  // Атомарно помечаем код использованным: параллельный запрос получит 0 строк.
  const consumed = await prisma.loginToken.updateMany({
    where: { tokenHash, status: LoginTokenStatus.APPROVED },
    data: { status: LoginTokenStatus.CONSUMED, consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    throw new UnauthorizedError('Код уже использован', 'LOGIN_CODE_USED');
  }

  return issueSession(token.userId, meta, AuthProvider.TELEGRAM_BOT_CODE);
}

// ─────────────────────────── Пользователь Telegram ──────────────────────────

/**
 * Создаёт или обновляет пользователя по данным Telegram.
 * Аватар из Telegram скачивается к нам: их CDN отдаёт ссылки с ограниченным
 * сроком жизни, и полагаться на них нельзя.
 */
export async function upsertTelegramUser(data: TelegramUserData, chatId?: bigint) {
  const existing = await prisma.user.findUnique({ where: { telegramId: data.telegramId } });

  if (!existing) {
    const isSuperAdmin = await shouldBecomeSuperAdmin(data.telegramId);
    let avatarUrl: string | null = null;
    if (data.photoUrl) {
      const stored = await downloadAndStoreAvatar(data.photoUrl);
      if (stored) avatarUrl = `/api/files/avatars/${stored}`;
    }

    return prisma.user.create({
      data: {
        telegramId: data.telegramId,
        tgUsername: data.username,
        tgFirstName: data.firstName,
        tgLastName: data.lastName,
        displayName: buildDisplayName(data),
        avatarUrl,
        globalRole: isSuperAdmin ? GlobalRole.SUPERADMIN : GlobalRole.USER,
        locale: data.languageCode === 'en' ? 'en' : 'ru',
        notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES as object,
        // Профиль не считается готовым, пока человек сам не подтвердит имя и аватар.
        profileCompleted: false,
        ...(chatId !== undefined ? { botChatId: chatId, botStartedAt: new Date() } : {}),
      },
    });
  }

  if (!existing.isActive) {
    throw new ForbiddenError('Учётная запись отключена', 'USER_INACTIVE');
  }

  let avatarUrl = existing.avatarUrl;
  // Аватар из Telegram подтягиваем только если пользователь не загрузил свой.
  if (!existing.avatarCustom && data.photoUrl && !existing.avatarUrl) {
    const stored = await downloadAndStoreAvatar(data.photoUrl);
    if (stored) avatarUrl = `/api/files/avatars/${stored}`;
  }

  return prisma.user.update({
    where: { id: existing.id },
    data: {
      tgUsername: data.username,
      tgFirstName: data.firstName,
      tgLastName: data.lastName,
      avatarUrl,
      ...(chatId !== undefined
        ? { botChatId: chatId, botBlocked: false, botStartedAt: existing.botStartedAt ?? new Date() }
        : {}),
    },
  });
}

/**
 * Кому выдать права администратора при первом входе.
 *
 * Обычный путь — перечислить Telegram ID в `SUPERADMIN_TELEGRAM_IDS`.
 * Но при первом запуске системы этих ID ещё неоткуда взять, а без
 * администратора доска бесполезна: некому раздать роли и посмотреть аудит.
 *
 * Поэтому есть подстраховка: если в базе нет ни одного администратора,
 * им становится первый вошедший. Это безопасно ровно до того момента,
 * пока адрес знает только тот, кто разворачивал систему, — поэтому
 * событие пишется в журнал безопасности.
 */
async function shouldBecomeSuperAdmin(telegramId: bigint): Promise<boolean> {
  if (env.superAdminTelegramIds.includes(telegramId)) return true;

  const existingAdmins = await prisma.user.count({
    where: { globalRole: GlobalRole.SUPERADMIN },
  });
  if (existingAdmins > 0) return false;

  logger.warn(
    { telegramId: telegramId.toString() },
    'Администраторов нет — первый вошедший получает права администратора',
  );
  return true;
}

// ──────────────────────────────── Сессии ────────────────────────────────────

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  userId: string;
}

export async function issueSession(
  userId: string,
  meta: RequestMeta,
  provider: AuthProvider,
  family?: string,
): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, globalRole: true, tokenVersion: true, profileCompleted: true, isActive: true },
  });
  if (!user) throw new NotFoundError('Пользователь не найден');
  if (!user.isActive) throw new ForbiddenError('Учётная запись отключена', 'USER_INACTIVE');

  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: sha256Hex(refreshToken),
      family: family ?? randomToken(16),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      deviceLabel: meta.deviceLabel?.slice(0, 120) ?? null,
      provider,
      expiresAt,
      lastUsedAt: new Date(),
    },
    select: { id: true },
  });

  const payload: AccessTokenPayload = {
    sub: user.id,
    sid: session.id,
    role: user.globalRole,
    ver: user.tokenVersion,
    pc: user.profileCompleted,
  };

  return {
    accessToken: await signAccessToken(payload),
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    sessionId: session.id,
    userId: user.id,
  };
}

/**
 * Ротация refresh-токена с обнаружением повторного использования.
 *
 * Если пришёл токен, который уже был обменян, значит его кто-то украл
 * (или клиент сломан). В этом случае отзываем всю «семью» сессий и
 * предупреждаем пользователя в Telegram.
 */
export async function rotateSession(
  refreshToken: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const hash = sha256Hex(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    select: {
      id: true,
      userId: true,
      family: true,
      revokedAt: true,
      expiresAt: true,
      provider: true,
    },
  });

  if (!session) throw new UnauthorizedError('Сессия не найдена', 'SESSION_NOT_FOUND');

  if (session.revokedAt) {
    await revokeFamily(session.family, 'REUSE_DETECTED');
    await recordSecurityEvent(session.userId, SecurityEventType.TOKEN_REUSE_DETECTED, meta, {
      family: session.family,
    });
    await notifySecurity(
      session.userId,
      'Обнаружена попытка входа с устаревшим токеном. Все сессии завершены — войдите заново.',
    );
    throw new UnauthorizedError('Сессия скомпрометирована, войдите заново', 'TOKEN_REUSE');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Срок сессии истёк', 'SESSION_EXPIRED');
  }

  const issued = await issueSession(session.userId, meta, session.provider, session.family);

  await prisma.session.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: 'ROTATED',
      replacedById: issued.sessionId,
      lastUsedAt: new Date(),
    },
  });
  await markSessionRevoked(session.id, env.ACCESS_TOKEN_TTL_SECONDS + 60);
  await recordSecurityEvent(session.userId, SecurityEventType.TOKEN_REFRESHED, meta);

  return issued;
}

export async function revokeFamily(family: string, reason: string): Promise<void> {
  const sessions = await prisma.session.findMany({
    where: { family, revokedAt: null },
    select: { id: true },
  });
  await prisma.session.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await Promise.all(
    sessions.map((s) => markSessionRevoked(s.id, env.ACCESS_TOKEN_TTL_SECONDS + 60)),
  );
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  reason = 'LOGOUT',
): Promise<void> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  if (result.count > 0) {
    await markSessionRevoked(sessionId, env.ACCESS_TOKEN_TTL_SECONDS + 60);
    // Другая вкладка узнаёт о выходе сразу, а не через 15 минут,
    // когда протухнет access-токен.
    await publishRealtime({
      room: rooms.user(userId),
      event: SOCKET_EVENTS.SESSION_REVOKED,
      data: { sessionId, reason },
    });
  }
}

/** Выход со всех устройств: инкремент версии токенов делает недействительными все JWT. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
    }),
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ]);
  await Promise.all(
    sessions.map((s) => markSessionRevoked(s.id, env.ACCESS_TOKEN_TTL_SECONDS + 60)),
  );
  await publishRealtime({
    room: rooms.user(userId),
    event: SOCKET_EVENTS.SESSION_REVOKED,
    data: { reason: 'LOGOUT_ALL' },
  });
}

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      deviceLabel: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.deviceLabel ?? session.userAgent,
    ip: session.ip,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
  }));
}
