import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Кого считать вором, а кого — человеком с моргнувшей сетью.
 *
 * Раньше любой уже обменянный токен означал кражу: отзывалась вся семья
 * сессий и в Telegram улетало «Все сессии завершены». Ровно так же выглядели
 * две вкладки и потерянный ответ на обновление, поэтому людей выбрасывало
 * из аккаунта на ровном месте.
 */

let classify: typeof import('./service.js')['classifyRotationFailure'];
let graceMs: number;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:4998',
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/kaif_test?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    INTERNAL_API_SECRET: 'internal-secret-internal-secret-1234',
    TELEGRAM_BOT_TOKEN: '123456789:AAHfaketokenfaketokenfaketokenfaketoken',
    TELEGRAM_BOT_USERNAME: 'kaif_test_bot',
    STORAGE_DIR: './.tmp-test-storage',
    ENABLE_WORKERS: 'false',
    ENABLE_REALTIME: 'false',
  });
  const mod = await import('./service.js');
  classify = mod.classifyRotationFailure;
  graceMs = mod.ROTATION_GRACE_MS;
});

const now = new Date('2026-08-25T12:00:00Z');
const agoMs = (ms: number): Date => new Date(now.getTime() - ms);

describe('разбор неудачной ротации', () => {
  it('сессия не отзывалась — просто вышел срок', () => {
    expect(classify({ revokedAt: null, revokedReason: null, now })).toBe('expired');
  });

  it('вторая вкладка обновилась секунду назад — это свой, а не вор', () => {
    expect(classify({ revokedAt: agoMs(1_000), revokedReason: 'ROTATED', now })).toBe('retry');
  });

  it('параллельная ротация ещё идёт — тоже свой', () => {
    expect(classify({ revokedAt: agoMs(50), revokedReason: 'ROTATING', now })).toBe('retry');
  });

  it('ответ не дошёл, человек вернулся через полминуты — свой', () => {
    expect(classify({ revokedAt: agoMs(30_000), revokedReason: 'ROTATED', now })).toBe('retry');
  });

  it('старый токен принесли через час — вот это кража', () => {
    expect(classify({ revokedAt: agoMs(3_600_000), revokedReason: 'ROTATED', now })).toBe('reuse');
  });

  it('на границе окна отсрочки уже тревога', () => {
    expect(classify({ revokedAt: agoMs(graceMs), revokedReason: 'ROTATED', now })).toBe('reuse');
  });

  it('вышел сам — показываем вход, но не поднимаем тревогу', () => {
    expect(classify({ revokedAt: agoMs(1_000), revokedReason: 'LOGOUT', now })).toBe('revoked');
    expect(classify({ revokedAt: agoMs(1_000), revokedReason: 'LOGOUT_ALL', now })).toBe('revoked');
  });

  it('сессию погасил администратор — тоже не тревога', () => {
    expect(classify({ revokedAt: agoMs(1_000), revokedReason: 'REUSE_DETECTED', now })).toBe(
      'revoked',
    );
  });
});
