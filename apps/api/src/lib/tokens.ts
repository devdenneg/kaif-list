import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { GlobalRole } from '@kaif/shared';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'kaif-board';
const AUDIENCE = 'kaif-board-web';

export interface AccessTokenPayload {
  /** id пользователя */
  sub: string;
  /** id сессии — позволяет мгновенно отозвать конкретное устройство */
  sid: string;
  role: GlobalRole;
  /** версия токенов пользователя: инкремент разлогинивает везде */
  ver: number;
  /** профиль заполнен — иначе доступ только к онбордингу */
  pc: boolean;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 5,
    });

    const sub = payload.sub;
    const sid = payload.sid;
    const role = payload.role;
    const ver = payload.ver;
    const pc = payload.pc;

    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof role !== 'string' ||
      typeof ver !== 'number' ||
      typeof pc !== 'boolean'
    ) {
      throw new UnauthorizedError('Некорректный токен', 'INVALID_TOKEN');
    }

    return { sub, sid, role: role as GlobalRole, ver, pc };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError('Срок действия токена истёк', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Некорректный токен', 'INVALID_TOKEN');
  }
}

export const REFRESH_COOKIE_NAME = 'kaif_rt';

/** Параметры refresh-cookie. Path сужен до /api/auth — токен не летит с каждым запросом. */
export function refreshCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: maxAgeSeconds,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export const refreshTokenTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
