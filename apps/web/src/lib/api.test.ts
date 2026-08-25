import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Никого не выбрасывает из аккаунта из-за помех.
 *
 * Реальная жалоба: «давно ничего не нажимал, потом нажал — и окно входа
 * через Telegram». Одна из причин была здесь: любой неуспешный ответ на
 * обновление токена считался «вы не авторизованы», включая 502 от прокси
 * во время выкатки и обрыв связи.
 */

const origin = 'http://localhost:5173';

beforeAll(() => {
  // Клиент строит адреса от window.location — в тестовой среде его нет.
  (globalThis as { window?: unknown }).window = { location: { origin } };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadApi() {
  vi.resetModules();
  return import('./api');
}

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('обновление сессии', () => {
  it('502 при выкатке не разлогинивает', async () => {
    const { refreshSession, onAuthChange } = await loadApi();
    respondWith(502, { error: { code: 'BAD_GATEWAY', message: 'Плохой шлюз' } });

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    expect(await refreshSession()).toBe(false);
    // Главное: приложению не сказали «пользователь вышел».
    expect(events).toEqual([]);
  });

  it('обрыв сети не разлогинивает', async () => {
    const { refreshSession, onAuthChange } = await loadApi();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    expect(await refreshSession()).toBe(false);
    expect(events).toEqual([]);
  });

  it('лимит частоты не разлогинивает', async () => {
    const { refreshSession, onAuthChange } = await loadApi();
    respondWith(429, { error: { code: 'RATE_LIMITED', message: 'Слишком часто' } });

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    await refreshSession();
    expect(events).toEqual([]);
  });

  it('истёкшая сессия — единственный повод показать вход', async () => {
    const { refreshSession, onAuthChange } = await loadApi();
    respondWith(401, { error: { code: 'SESSION_EXPIRED', message: 'Срок сессии истёк' } });

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    expect(await refreshSession()).toBe(false);
    expect(events).toEqual([false]);
  });

  it('устаревший токен после смены роли не разлогинивает', async () => {
    const { refreshSession, onAuthChange } = await loadApi();
    respondWith(401, { error: { code: 'TOKEN_STALE', message: 'Сессия устарела' } });

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    await refreshSession();
    expect(events).toEqual([]);
  });

  it('успешное обновление сообщает, что человек на месте', async () => {
    const { refreshSession, onAuthChange, getAccessToken } = await loadApi();
    respondWith(200, { accessToken: 'новый-токен' });

    const events: boolean[] = [];
    onAuthChange((authenticated) => events.push(authenticated));

    expect(await refreshSession()).toBe(true);
    expect(events).toEqual([true]);
    expect(getAccessToken()).toBe('новый-токен');
  });
});
