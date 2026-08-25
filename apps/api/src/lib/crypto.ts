import crypto from 'node:crypto';

/** Криптостойкий токен в base64url — коды входа, refresh-токены, имена файлов. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256Buffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Сравнение секретов за постоянное время.
 * Обычный `===` на строках утекает информацию через тайминги.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Всё равно выполняем сравнение, чтобы время не зависело от длины.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 в hex. */
export function hmacSha256Hex(key: crypto.BinaryLike | crypto.KeyObject, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/** Короткий несекретный идентификатор для логов и имён файлов. */
export function shortId(length = 12): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
