import { beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';

let peopleSearchWhere: (userId: string, query: string) => Prisma.UserWhereInput;

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
  ({ peopleSearchWhere } = await import('./routes.js'));
});

/**
 * Состав компании не должен утекать в обычный поиск.
 *
 * Раньше у суперадмина условие «есть общая доска» просто отключалось, и
 * командная палитра показывала ему всех, кто когда-либо завёл аккаунт.
 * Проверка нужна именно на форме условия: для запроса к базе нет тестовой
 * среды, а забыть эту строку легко — что однажды и произошло.
 */
describe('поиск людей', () => {
  it('ограничен общими досками', () => {
    const where = peopleSearchWhere('user-1', 'иван');
    expect(where.memberships).toEqual({
      some: { board: { members: { some: { userId: 'user-1' } } } },
    });
  });

  it('ищет и по имени, и по телеграм-нику', () => {
    const where = peopleSearchWhere('user-1', 'иван');
    expect(where.OR).toEqual([
      { displayName: { contains: 'иван', mode: 'insensitive' } },
      { tgUsername: { contains: 'иван', mode: 'insensitive' } },
    ]);
  });

  it('отключённые учётные записи не показываются', () => {
    expect(peopleSearchWhere('user-1', 'иван').isActive).toBe(true);
  });

  it('условие одинаково для любого, кто спрашивает', () => {
    // Роль в форму условия не входит вообще — исключений быть не может.
    const first = JSON.stringify(peopleSearchWhere('superadmin-1', 'иван'));
    const second = JSON.stringify(peopleSearchWhere('member-1', 'иван'));
    expect(first.replace('superadmin-1', 'X')).toBe(second.replace('member-1', 'X'));
  });
});
