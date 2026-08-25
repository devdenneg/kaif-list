import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AuthProvider,
  SecurityEventType,
  TTL,
  completeProfileSchema,
  loginCodeSchema,
  requestLoginCodeSchema,
  telegramMiniAppAuthSchema,
  telegramWidgetAuthSchema,
  type LoginCodeDto,
} from '@kaif/shared';
import { env } from '../../config/env.js';
import { authRateLimit } from '../../plugins/security.js';
import { requireUser } from '../../plugins/auth.js';
import { requestMeta } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { sha256Hex } from '../../lib/crypto.js';
import { claimOnce } from '../../lib/redis.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  refreshTokenTtlSeconds,
} from '../../lib/tokens.js';
import { verifyMiniAppInitData, verifyWidgetAuth } from '../../lib/telegram-auth.js';
import { getCurrentUser } from '../users/service.js';
import {
  consumeLoginCode,
  reissueAccessToken,
  createLoginCode,
  getLoginCodeStatus,
  issueSession,
  listSessions,
  recordSecurityEvent,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  upsertTelegramUser,
  type IssuedSession,
} from './service.js';
import { completeProfile } from './profile.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Общий ответ на успешный вход: access-токен в теле, refresh — в HttpOnly-cookie. */
  async function respondWithSession(reply: FastifyReply, issued: IssuedSession) {
    const user = await getCurrentUser(issued.userId);
    return reply
      .setCookie(
        REFRESH_COOKIE_NAME,
        issued.refreshToken,
        refreshCookieOptions(refreshTokenTtlSeconds),
      )
      .send({ accessToken: issued.accessToken, expiresIn: issued.expiresIn, user });
  }

  // ── Вход через бота по одноразовому коду ──────────────────────────────────

  app.post('/telegram/login-code', authRateLimit, async (request, reply) => {
    const body = requestLoginCodeSchema.parse(request.body ?? {});
    const code = await createLoginCode(requestMeta(request, body.deviceLabel ?? null));
    // Тип проставлен намеренно: ответ уже расходился с контрактом —
    // забытый verificationCode оставлял на экране пустую рамку, и сверять
    // с ботом было нечего. Теперь такое не соберётся.
    const payload: LoginCodeDto = {
      code: code.code,
      verificationCode: code.verificationCode,
      deepLink: code.deepLink,
      botUsername: code.botUsername,
      expiresAt: code.expiresAt.toISOString(),
      pollIntervalMs: TTL.loginCodePollIntervalMs,
    };
    return reply.send(payload);
  });

  app.get<{ Params: { code: string } }>(
    '/telegram/login-code/:code/status',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code } = loginCodeSchema.parse({ code: request.params.code });
      const status = await getLoginCodeStatus(code);
      return reply.send({ status });
    },
  );

  app.post('/telegram/exchange', authRateLimit, async (request, reply) => {
    const { code } = loginCodeSchema.parse(request.body);
    const meta = requestMeta(request);
    const issued = await consumeLoginCode(code, meta);
    await recordSecurityEvent(issued.userId, SecurityEventType.LOGIN_SUCCESS, meta, {
      provider: AuthProvider.TELEGRAM_BOT_CODE,
    });
    return respondWithSession(reply, issued);
  });

  // ── Telegram Login Widget ─────────────────────────────────────────────────

  app.post('/telegram/widget', authRateLimit, async (request, reply) => {
    const payload = telegramWidgetAuthSchema.parse(request.body);
    const meta = requestMeta(request);

    const result = verifyWidgetAuth(
      payload as unknown as Record<string, unknown>,
      env.TELEGRAM_BOT_TOKEN,
    );
    if (!result.ok) {
      await recordSecurityEvent(null, SecurityEventType.LOGIN_FAILED, meta, {
        provider: AuthProvider.TELEGRAM_WIDGET,
        reason: result.reason,
      });
      throw new UnauthorizedError('Не удалось подтвердить данные Telegram', 'TELEGRAM_AUTH_FAILED');
    }

    // Защита от повторного использования одной и той же подписи.
    const fresh = await claimOnce(`tg:widget:${result.data.hash}`, TTL.replayCacheSeconds);
    if (!fresh) {
      await recordSecurityEvent(null, SecurityEventType.LOGIN_FAILED, meta, { reason: 'REPLAY' });
      throw new UnauthorizedError('Данные авторизации уже использованы', 'TELEGRAM_AUTH_REPLAY');
    }

    const user = await upsertTelegramUser(result.data);
    const issued = await issueSession(user.id, meta, AuthProvider.TELEGRAM_WIDGET);
    await recordSecurityEvent(user.id, SecurityEventType.LOGIN_SUCCESS, meta, {
      provider: AuthProvider.TELEGRAM_WIDGET,
    });
    return respondWithSession(reply, issued);
  });

  // ── Telegram Mini App ─────────────────────────────────────────────────────

  app.post('/telegram/mini-app', authRateLimit, async (request, reply) => {
    const { initData } = telegramMiniAppAuthSchema.parse(request.body);
    const meta = requestMeta(request, 'Telegram Mini App');

    const result = verifyMiniAppInitData(initData, env.TELEGRAM_BOT_TOKEN);
    if (!result.ok) {
      await recordSecurityEvent(null, SecurityEventType.LOGIN_FAILED, meta, {
        provider: AuthProvider.TELEGRAM_MINI_APP,
        reason: result.reason,
      });
      throw new UnauthorizedError('Не удалось подтвердить данные Telegram', 'TELEGRAM_AUTH_FAILED');
    }

    const fresh = await claimOnce(`tg:miniapp:${result.data.hash}`, TTL.replayCacheSeconds);
    if (!fresh) {
      throw new UnauthorizedError('Данные авторизации уже использованы', 'TELEGRAM_AUTH_REPLAY');
    }

    const user = await upsertTelegramUser(result.data);
    const issued = await issueSession(user.id, meta, AuthProvider.TELEGRAM_MINI_APP);
    await recordSecurityEvent(user.id, SecurityEventType.LOGIN_SUCCESS, meta, {
      provider: AuthProvider.TELEGRAM_MINI_APP,
    });
    return respondWithSession(reply, issued);
  });

  // ── Обновление и завершение сессии ────────────────────────────────────────

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) throw new UnauthorizedError('Нет refresh-токена', 'NO_REFRESH_TOKEN');
    const issued = await rotateSession(token, requestMeta(request));
    return respondWithSession(reply, issued);
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    const meta = requestMeta(request);

    if (token) {
      const session = await prisma.session.findUnique({
        where: { refreshTokenHash: sha256Hex(token) },
        select: { id: true, userId: true },
      });
      if (session) {
        await revokeSession(session.userId, session.id, 'LOGOUT');
        await recordSecurityEvent(session.userId, SecurityEventType.LOGOUT, meta);
      }
    }

    return reply
      .clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(0))
      .send({ success: true });
  });

  app.post('/logout-all', { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    await revokeAllSessions(user.id);
    await recordSecurityEvent(user.id, SecurityEventType.LOGOUT_ALL, requestMeta(request));
    return reply
      .clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(0))
      .send({ success: true });
  });

  // ── Профиль текущего пользователя ─────────────────────────────────────────

  app.get('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    return reply.send({ user: await getCurrentUser(user.id) });
  });

  /**
   * Завершение онбординга: имя и аватар обязательны.
   * До этого момента остальные ручки закрыты хуком `requireProfile`.
   */
  app.post('/profile', { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const body = completeProfileSchema.parse(request.body);
    const updated = await completeProfile(user.id, body);
    await recordSecurityEvent(user.id, SecurityEventType.PROFILE_COMPLETED, requestMeta(request));

    // Профиль изменился — обновляем access-токен для ТЕКУЩЕЙ сессии.
    // Новую сессию здесь заводить нельзя: один вход давал бы две записи
    // в списке активных устройств.
    const accessToken = await reissueAccessToken(user.id, user.sessionId);
    return reply.send({
      accessToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      user: updated,
    });
  });

  // ── Активные сессии ───────────────────────────────────────────────────────

  app.get('/sessions', { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    return reply.send({ items: await listSessions(user.id, user.sessionId) });
  });

  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = requireUser(request);
      const sessionId = request.params.id;
      if (!sessionId || sessionId.length < 8) throw new BadRequestError('Некорректная сессия');
      await revokeSession(user.id, sessionId, 'REVOKED_BY_USER');
      await recordSecurityEvent(user.id, SecurityEventType.SESSION_REVOKED, requestMeta(request), {
        sessionId,
      });
      return reply.send({ success: true });
    },
  );
}
