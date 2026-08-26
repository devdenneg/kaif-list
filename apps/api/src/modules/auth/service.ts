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
import crypto from 'node:crypto';
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
  verificationCode: string;
  deepLink: string;
  botUsername: string;
  expiresAt: Date;
}

/**
 * Короткий код для сверки глазами.
 *
 * Исключены символы, которые легко перепутать (0/O, 1/I/L): человек будет
 * сравнивать их на экране телефона и на экране компьютера, и «почти
 * совпало» здесь недопустимо — на этом сравнении держится защита от того,
 * чтобы впустить чужой браузер.
 */
function generateVerificationCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(4);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * Выдаёт одноразовый код входа. В БД хранится только хеш —
 * даже дамп базы не позволит войти чужим кодом.
 */
export async function createLoginCode(meta: RequestMeta): Promise<LoginCode> {
  const code = randomToken(24);
  const verificationCode = generateVerificationCode();
  const expiresAt = new Date(Date.now() + TTL.loginCodeSeconds * 1000);

  await prisma.loginToken.create({
    data: {
      tokenHash: sha256Hex(code),
      verificationCode,
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
    verificationCode,
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

export interface PendingLogin {
  verificationCode: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}

/**
 * Сведения о запросе входа — то, что бот показывает человеку перед подтверждением.
 *
 * Раньше `/start <код>` одобрял вход сразу. Это опасно: код знает тот, кто его
 * запросил, а подтверждает тот, кто нажал кнопку в Telegram. Прислав жертве
 * ссылку на свой код, посторонний получал сессию под её именем.
 * Теперь человек видит, какое устройство просится внутрь, и сверяет код.
 */
export async function describeLoginRequest(
  code: string,
): Promise<{ ok: true; pending: PendingLogin } | { ok: false; reason: string }> {
  const token = await prisma.loginToken.findUnique({ where: { tokenHash: sha256Hex(code) } });

  if (!token) return { ok: false, reason: 'NOT_FOUND' };
  if (token.status !== LoginTokenStatus.PENDING) return { ok: false, reason: 'ALREADY_USED' };
  if (token.expiresAt.getTime() < Date.now()) {
    await prisma.loginToken.update({
      where: { id: token.id },
      data: { status: LoginTokenStatus.EXPIRED },
    });
    return { ok: false, reason: 'EXPIRED' };
  }

  return {
    ok: true,
    pending: {
      verificationCode: token.verificationCode,
      deviceLabel: token.deviceLabel,
      ip: token.ip,
      userAgent: token.userAgent,
      expiresAt: token.expiresAt,
    },
  };
}

/**
 * Подтверждение или отклонение входа человеком в Telegram.
 * Бот достоверно знает telegram_id отправителя, потому что сообщение
 * пришло от серверов Telegram.
 */
export async function confirmLoginCode(
  code: string,
  telegramUser: TelegramUserData,
  chatId: bigint,
  approve: boolean,
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

  if (!approve) {
    // Отклонённый вход гасим сразу: кодом больше воспользоваться нельзя.
    await prisma.loginToken.update({
      where: { tokenHash },
      data: { status: LoginTokenStatus.EXPIRED },
    });
    await recordSecurityEvent(
      user.id,
      SecurityEventType.LOGIN_FAILED,
      { ip: token.ip, userAgent: token.userAgent },
      { via: 'bot', reason: 'REJECTED_BY_USER' },
    );
    return { approved: false, reason: 'REJECTED' };
  }

  await prisma.loginToken.update({
    where: { tokenHash },
    data: { status: LoginTokenStatus.APPROVED, userId: user.id, approvedAt: new Date() },
  });

  await recordSecurityEvent(
    user.id,
    SecurityEventType.LOGIN_CODE_APPROVED,
    { ip: token.ip, userAgent: token.userAgent },
    { via: 'bot', deviceLabel: token.deviceLabel },
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
  // Срок отсчитывается заново при каждом обновлении: окно скользящее,
  // и у того, кто заходит хотя бы иногда, сессия не кончается никогда.
  // Закончиться она может только выходом, отзывом или отключением учётки.
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
 * Тонкое место: «токен уже обменян» — это не всегда кража. Ровно так же
 * выглядят две вкладки, стартующие одновременно, и оборванный ответ
 * (мобильная сеть моргнула, вкладку усыпили, контейнер перезапустился при
 * выкатке) — в базе ротация зафиксирована, а до браузера новая кука не дошла.
 *
 * Поэтому:
 *  - токен занимается атомарно, и при одновременных запросах выигрывает ровно
 *    один; проигравший не считается вором;
 *  - в течение короткого окна отсрочки повторное обращение со старым токеном
 *    обслуживается как ретрай — человеку выдаётся рабочая пара;
 *  - вся семья сессий гасится только если старый токен пришёл ПОЗЖЕ окна:
 *    вот это уже подпись кражи;
 *  - сессия, отозванная выходом или администратором, отвечает обычным 401
 *    без тревожного письма в Telegram.
 */

/** Сколько ретрай со старым токеном считается своим, а не кражей. */
export const ROTATION_GRACE_MS = 60_000;
/** Сколько ждём, пока параллельная ротация допишет замену. */
const ROTATION_WAIT_MS = 2_000;
const ROTATION_POLL_MS = 120;

const RETRYABLE_REASONS = new Set(['ROTATED', 'ROTATING']);

export async function rotateSession(
  refreshToken: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const hash = sha256Hex(refreshToken);
  const now = new Date();

  // Занимаем токен одним запросом: две вкладки не могут выиграть обе.
  const claim = await prisma.session.updateMany({
    where: { refreshTokenHash: hash, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now, revokedReason: 'ROTATING', lastUsedAt: now },
  });

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    select: {
      id: true,
      userId: true,
      family: true,
      revokedAt: true,
      revokedReason: true,
      replacedById: true,
      expiresAt: true,
      provider: true,
    },
  });
  if (!session) throw new UnauthorizedError('Сессия не найдена', 'SESSION_NOT_FOUND');

  if (claim.count === 1) {
    const issued = await issueSession(session.userId, meta, session.provider, session.family);
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedReason: 'ROTATED', replacedById: issued.sessionId },
    });
    await markSessionRevoked(session.id, env.ACCESS_TOKEN_TTL_SECONDS + 60);
    await recordSecurityEvent(session.userId, SecurityEventType.TOKEN_REFRESHED, meta);
    return issued;
  }

  // Заняться не удалось. Разбираемся почему.
  const verdict = classifyRotationFailure({
    revokedAt: session.revokedAt,
    revokedReason: session.revokedReason,
    now,
  });

  if (verdict === 'expired') {
    throw new UnauthorizedError('Срок сессии истёк', 'SESSION_EXPIRED');
  }

  if (verdict === 'revoked') {
    // Выход, отзыв устройства, отключение учётной записи. Это ожидаемо:
    // просим войти заново и не поднимаем тревогу.
    throw new UnauthorizedError('Сессия завершена, войдите заново', 'SESSION_REVOKED');
  }

  if (verdict === 'retry') {
    const retried = await retryRotation(session.id, meta);
    if (retried) {
      await recordSecurityEvent(session.userId, SecurityEventType.TOKEN_REFRESHED, meta, {
        retry: true,
      });
      return retried;
    }
  }

  const revokedAgoMs = session.revokedAt ? now.getTime() - session.revokedAt.getTime() : 0;

  // Старый токен принесли сильно позже — так выглядит именно кража.
  await revokeFamily(session.family, 'REUSE_DETECTED');
  await recordSecurityEvent(session.userId, SecurityEventType.TOKEN_REUSE_DETECTED, meta, {
    family: session.family,
    revokedAgoMs,
  });
  await notifySecurity(
    session.userId,
    'Обнаружена попытка входа с устаревшим токеном. Все сессии завершены — войдите заново.',
  );
  throw new UnauthorizedError('Сессия скомпрометирована, войдите заново', 'TOKEN_REUSE');
}

/**
 * Почему занять токен не удалось.
 *
 *  - `expired`  — срок сессии вышел, отзыва не было;
 *  - `revoked`  — вышли сами или отозвал администратор, тревожить не нужно;
 *  - `retry`    — токен только что обменяли: это вторая вкладка или повтор
 *                 после потерянного ответа, человеку положена рабочая пара;
 *  - `reuse`    — старый токен принесли много позже, так выглядит кража.
 *
 * Вынесено отдельно, потому что именно здесь решается, увидит человек доску
 * или экран входа, — и это должно проверяться тестом, а не на живых людях.
 */
export function classifyRotationFailure(input: {
  revokedAt: Date | null;
  revokedReason: string | null;
  now: Date;
  graceMs?: number;
}): 'expired' | 'revoked' | 'retry' | 'reuse' {
  if (!input.revokedAt) return 'expired';
  if (!RETRYABLE_REASONS.has(input.revokedReason ?? '')) return 'revoked';

  const graceMs = input.graceMs ?? ROTATION_GRACE_MS;
  const agoMs = input.now.getTime() - input.revokedAt.getTime();
  return agoMs < graceMs ? 'retry' : 'reuse';
}

/**
 * Обслуживание повторного обращения со старым токеном внутри окна отсрочки.
 *
 * Идём по цепочке замен до живой сессии и выдаём от неё новую пару. Если
 * параллельная ротация ещё в процессе (замены пока нет), ждём её пару секунд —
 * это дешевле, чем выбросить человека на экран входа.
 */
async function retryRotation(sessionId: string, meta: RequestMeta): Promise<IssuedSession | null> {
  const deadline = Date.now() + ROTATION_WAIT_MS;

  let currentId: string | null = sessionId;
  let hops = 0;

  while (currentId && hops < 5) {
    const row: {
      id: string;
      userId: string;
      family: string;
      provider: AuthProvider;
      revokedAt: Date | null;
      revokedReason: string | null;
      replacedById: string | null;
      expiresAt: Date;
    } | null = await prisma.session.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        userId: true,
        family: true,
        provider: true,
        revokedAt: true,
        revokedReason: true,
        replacedById: true,
        expiresAt: true,
      },
    });
    if (!row) return null;

    if (!row.revokedAt) {
      // Живая замена: занимаем её и выдаём пару, цепочка остаётся линейной.
      const claimed = await prisma.session.updateMany({
        where: { id: row.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revokedReason: 'ROTATING', lastUsedAt: new Date() },
      });
      if (claimed.count !== 1) {
        // Кто-то успел раньше — идём дальше по цепочке.
        hops += 1;
        continue;
      }
      const issued = await issueSession(row.userId, meta, row.provider, row.family);
      await prisma.session.update({
        where: { id: row.id },
        data: { revokedReason: 'ROTATED', replacedById: issued.sessionId },
      });
      await markSessionRevoked(row.id, env.ACCESS_TOKEN_TTL_SECONDS + 60);
      return issued;
    }

    if (!RETRYABLE_REASONS.has(row.revokedReason ?? '')) return null;

    if (!row.replacedById) {
      // Параллельная ротация ещё пишет замену — подождём немного.
      if (Date.now() > deadline) return null;
      await sleep(ROTATION_POLL_MS);
      continue;
    }

    currentId = row.replacedById;
    hops += 1;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Перевыпуск только access-токена для уже существующей сессии.
 *
 * Нужен там, где изменились данные внутри токена (например, профиль стал
 * заполненным), но заводить новую сессию незачем: иначе один вход
 * оставляет в списке устройств две записи и человек справедливо
 * подозревает неладное.
 */
export async function reissueAccessToken(userId: string, sessionId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, globalRole: true, tokenVersion: true, profileCompleted: true },
  });
  if (!user) throw new NotFoundError('Пользователь не найден');

  return signAccessToken({
    sub: user.id,
    sid: sessionId,
    role: user.globalRole,
    ver: user.tokenVersion,
    pc: user.profileCompleted,
  });
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
/**
 * Обесценить выданные access-токены, не трогая сами сессии.
 *
 * Нужно, когда изменилось содержимое токена — например, глобальная роль.
 * Клиент получит один отказ, молча обменяет refresh-куку и продолжит
 * работать с новыми правами. Гасить при этом сессии нельзя: человек
 * не делал ничего плохого, а выглядело бы это как взлом.
 */
export async function invalidateAccessTokens(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

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
