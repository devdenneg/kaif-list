import { beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';

/**
 * Живым блокером считается только незакрытая задача.
 *
 * Если это условие потерять, «разблокировано» не наступит никогда: человек
 * закроет блокер, а его коллега так и будет видеть «заблокирована» и не
 * сможет сдвинуть свою задачу. Ради уведомления «можно продолжать» всё
 * и затевалось.
 */

let activeBlockersWhere: (taskId: string) => Prisma.TaskLinkWhereInput;

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
  ({ activeBlockersWhere } = await import('./links.js'));
});

describe('счёт блокеров', () => {
  it('считает только связи «заблокирована»', () => {
    expect(activeBlockersWhere('task-1').type).toBe('BLOCKED_BY');
    expect(activeBlockersWhere('task-1').fromTaskId).toBe('task-1');
  });

  it('закрытая задача никого не держит', () => {
    const where = activeBlockersWhere('task-1');
    expect(where.toTask).toMatchObject({ columnKey: { not: 'DONE' } });
  });

  it('задача из архива никого не держит', () => {
    const where = activeBlockersWhere('task-1');
    expect(where.toTask).toMatchObject({ archivedAt: null });
  });
});
