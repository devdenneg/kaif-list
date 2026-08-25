import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { timingSafeEqual } from './crypto.js';

/**
 * Подписанные ссылки на файлы.
 *
 * Тег `<img>` не умеет отправлять заголовок Authorization, поэтому картинки
 * отдаются по ссылке с подписью: `?t=<exp>.<подпись>`. Подпись привязана
 * к конкретному файлу и имеет срок жизни, а сама ссылка непредсказуема.
 *
 * Срок округляется до суток — благодаря этому URL стабилен и кешируется
 * браузером, но всё равно протухает.
 */

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const ROUND_TO = 24 * 60 * 60;

function sign(attachmentId: string, exp: number): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`file:${attachmentId}:${exp}`)
    .digest('base64url');
}

export function signFileToken(attachmentId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.ceil((now + ttlSeconds) / ROUND_TO) * ROUND_TO;
  return `${exp}.${sign(attachmentId, exp)}`;
}

export function verifyFileToken(attachmentId: string, token: string | undefined): boolean {
  if (!token) return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const exp = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;

  return timingSafeEqual(sign(attachmentId, exp), signature);
}

/** Готовый URL файла с подписью. */
export function signedAttachmentUrl(attachmentId: string, thumb = false): string {
  const base = `${env.API_URL.replace(/\/$/, '')}/api/attachments/${attachmentId}${thumb ? '/thumb' : ''}`;
  return `${base}?t=${signFileToken(attachmentId)}`;
}
