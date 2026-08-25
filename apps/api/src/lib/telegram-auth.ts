import crypto from 'node:crypto';
import { TTL } from '@kaif/shared';
import { hmacSha256Hex, timingSafeEqual } from './crypto.js';

/**
 * Проверка подлинности данных, пришедших от Telegram.
 * Ни одно поле из этих данных не считается доверенным до успешной проверки подписи.
 */

export interface TelegramUserData {
  telegramId: bigint;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  authDate: Date;
  /** Значение hash — используется как ключ защиты от повторного использования. */
  hash: string;
}

export type VerifyResult =
  | { ok: true; data: TelegramUserData }
  | { ok: false; reason: string };

/** Login Widget: secret = SHA256(bot_token). */
export function verifyWidgetAuth(
  payload: Record<string, unknown>,
  botToken: string,
  maxAgeSeconds = TTL.telegramAuthMaxAgeSeconds,
  now: Date = new Date(),
): VerifyResult {
  const hash = typeof payload.hash === 'string' ? payload.hash : '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'BAD_HASH_FORMAT' };

  const dataCheckString = buildDataCheckString(payload, ['hash']);
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = hmacSha256Hex(secret, dataCheckString);

  if (!timingSafeEqual(expected.toLowerCase(), hash.toLowerCase())) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  const authDateRaw = Number(payload.auth_date);
  if (!Number.isFinite(authDateRaw)) return { ok: false, reason: 'BAD_AUTH_DATE' };
  const authDate = new Date(authDateRaw * 1000);
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: 'EXPIRED' };
  // Заметный сдвиг в будущее — признак подделки времени.
  if (ageSeconds < -60) return { ok: false, reason: 'FUTURE_AUTH_DATE' };

  const idRaw = payload.id;
  let telegramId: bigint;
  try {
    telegramId = BigInt(String(idRaw));
  } catch {
    return { ok: false, reason: 'BAD_USER_ID' };
  }
  if (telegramId <= 0n) return { ok: false, reason: 'BAD_USER_ID' };

  return {
    ok: true,
    data: {
      telegramId,
      firstName: asString(payload.first_name),
      lastName: asString(payload.last_name),
      username: asString(payload.username),
      photoUrl: asHttpsUrl(payload.photo_url),
      languageCode: null,
      authDate,
      hash,
    },
  };
}

/** Mini App: secret = HMAC_SHA256(key="WebAppData", data=bot_token). */
export function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = TTL.telegramAuthMaxAgeSeconds,
  now: Date = new Date(),
): VerifyResult {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'BAD_INIT_DATA' };
  }

  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'BAD_HASH_FORMAT' };

  const entries: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    entries[key] = value;
  }

  const dataCheckString = buildDataCheckString(entries, []);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = hmacSha256Hex(secret, dataCheckString);

  if (!timingSafeEqual(expected.toLowerCase(), hash.toLowerCase())) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  const authDateRaw = Number(entries.auth_date);
  if (!Number.isFinite(authDateRaw)) return { ok: false, reason: 'BAD_AUTH_DATE' };
  const authDate = new Date(authDateRaw * 1000);
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: 'EXPIRED' };
  if (ageSeconds < -60) return { ok: false, reason: 'FUTURE_AUTH_DATE' };

  const userRaw = entries.user;
  if (!userRaw) return { ok: false, reason: 'NO_USER' };

  let user: Record<string, unknown>;
  try {
    user = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'BAD_USER_JSON' };
  }

  let telegramId: bigint;
  try {
    telegramId = BigInt(String(user.id));
  } catch {
    return { ok: false, reason: 'BAD_USER_ID' };
  }
  if (telegramId <= 0n) return { ok: false, reason: 'BAD_USER_ID' };

  return {
    ok: true,
    data: {
      telegramId,
      firstName: asString(user.first_name),
      lastName: asString(user.last_name),
      username: asString(user.username),
      photoUrl: asHttpsUrl(user.photo_url),
      languageCode: asString(user.language_code),
      authDate,
      hash,
    },
  };
}

/** `key=value`, отсортировано по ключу, через перевод строки. */
function buildDataCheckString(payload: Record<string, unknown>, exclude: string[]): string {
  return Object.keys(payload)
    .filter((key) => !exclude.includes(key))
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join('\n');
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : null;
}

/** Разрешаем только https-ссылки на аватар — иначе это вектор для подстановки. */
function asHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, 512);
  } catch {
    return null;
  }
}

/** Отображаемое имя по данным Telegram — на случай, если пользователь ничего не ввёл. */
export function buildDisplayName(data: TelegramUserData): string {
  const parts = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
  if (parts.length >= 2) return parts.slice(0, 48);
  if (data.username) return data.username.slice(0, 48);
  return `Пользователь ${String(data.telegramId).slice(-4)}`;
}
