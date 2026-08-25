import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Интеграционные проверки HTTP-слоя.
 *
 * Специально подобраны так, чтобы не требовать ни базы, ни Redis:
 * все проверяемые ответы формируются до обращения к хранилищам.
 * Это позволяет гонять их в CI на каждом коммите и ловить самые обидные
 * ошибки — сломанную регистрацию роутов, дырявую авторизацию, изменившийся
 * формат ошибки.
 */

const ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  HOST: '127.0.0.1',
  PORT: '4998',
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
  TRUST_PROXY: 'false',
};

let app: FastifyInstance;

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const { buildServer } = await import('./server.js');
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('служебные ручки', () => {
  it('healthz отвечает без базы', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('формат ошибок', () => {
  it('несуществующий маршрут — 404 в едином формате', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/такого-нет' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('авторизация обязательна', () => {
  const protectedRoutes: [string, string][] = [
    ['GET', '/api/boards'],
    ['POST', '/api/boards'],
    ['GET', '/api/tasks/clxxxxxxxx'],
    ['GET', '/api/users'],
    ['GET', '/api/notifications'],
    ['GET', '/api/search?q=тест'],
    ['GET', '/api/admin/stats'],
  ];

  it.each(protectedRoutes)('%s %s без токена → 401', async (method, url) => {
    const response = await app.inject({ method: method as 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('NO_TOKEN');
  });

  it('битый токен не проходит', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { authorization: 'Bearer не-настоящий-токен' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('токен, подписанный чужим ключом, не проходит', async () => {
    const { SignJWT } = await import('jose');
    const foreign = new TextEncoder().encode('другой-секрет-другой-секрет-1234567890');
    const token = await new SignJWT({ sid: 'x', role: 'USER', ver: 0, pc: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('kaif-board')
      .setAudience('kaif-board-web')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(foreign);

    const response = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('валидация входных данных', () => {
  it('некорректный код входа отклоняется до обращения к базе', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram/exchange',
      payload: { code: '@@@' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields).toBeTruthy();
  });

  it('подделанная подпись Telegram отклоняется', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram/widget',
      payload: {
        id: 1,
        auth_date: Math.floor(Date.now() / 1000),
        hash: 'a'.repeat(64),
      },
    });
    // 401 — подпись не сошлась (до базы дело не доходит).
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TELEGRAM_AUTH_FAILED');
  });

  it('без refresh-cookie обновление сессии невозможно', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('NO_REFRESH_TOKEN');
  });
});

describe('служебный API закрыт секретом', () => {
  it('без заголовка — 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/telegram/blocked',
      payload: { chatId: '1' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BAD_INTERNAL_SECRET');
  });

  it('с неверным секретом — 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/telegram/blocked',
      headers: { 'x-internal-secret': 'подделка' },
      payload: { chatId: '1' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('защита от CSRF', () => {
  it('мутирующий запрос с чужого Origin отклоняется', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BAD_ORIGIN');
  });

  it('со своего Origin — проходит дальше', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: ENV.APP_URL },
    });
    expect(response.statusCode).not.toBe(403);
  });

  it('GET с чужого Origin не блокируется (данные защищает авторизация)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('файловые маршруты', () => {
  it('некорректное имя аватара отклоняется', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/files/avatars/../../etc/passwd' });
    expect([400, 404]).toContain(response.statusCode);
  });

  it('маршрут вложений зарегистрирован и не отдаёт файл без проверки', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/attachments/clxxxxxxxxxx' });
    // Сам файл без авторизации или подписи не отдаётся никогда.
    // Без базы данных запрос завершается 500 — это ожидаемо в изолированном тесте.
    expect(response.statusCode).not.toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });
});
