import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Защита от бесконечной перезагрузки.
 *
 * Реальная жалоба: в Safari страница перезагружалась без конца. Пометка
 * «мы уже перезагружались из-за этой страницы» стиралась при старте
 * приложения — то есть раньше, чем страница вообще пыталась загрузиться,
 * и защита не работала ни разу.
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.resetModules();

  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };

  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('window', { location: { reload: vi.fn() } });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('caches', undefined);
});

async function load() {
  return import('./lazy-with-retry');
}

describe('перезагрузка при пропавшем файле сборки', () => {
  it('после успешной загрузки страницы пометка снимается', async () => {
    const { lazyWithRetry } = await load();
    store.set('kaif:chunk-reload:боард', '1');

    const factory = vi.fn(async () => ({ default: () => null }));
    // React.lazy вызывает фабрику лениво — дёргаем её напрямую через _payload.
    const lazy = lazyWithRetry('боард', factory) as unknown as {
      _payload: { _result: () => Promise<unknown> };
      _init: (payload: unknown) => unknown;
    };
    await lazy._payload._result();

    expect(store.has('kaif:chunk-reload:боард')).toBe(false);
  });

  it('пометка ставится на конкретную страницу и держится', async () => {
    const { lazyWithRetry } = await load();

    const factory = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const lazy = lazyWithRetry('боард', factory) as unknown as {
      _payload: { _result: () => Promise<unknown> };
    };

    // Первый провал: перезагружаемся и запоминаем это.
    void lazy._payload._result();
    await vi.waitFor(() => expect(store.get('kaif:chunk-reload:боард')).toBe('1'));
    expect(store.get('kaif:chunk-reload-budget')).toBe('1');
  });

  it('общий потолок перезагрузок за сессию не даёт циклу гулять по страницам', async () => {
    const { lazyWithRetry } = await load();
    store.set('kaif:chunk-reload-budget', '2');

    const factory = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const lazy = lazyWithRetry('другая', factory) as unknown as {
      _payload: { _result: () => Promise<unknown> };
    };

    // Бюджет исчерпан — вместо перезагрузки честная ошибка на экране.
    await expect(lazy._payload._result()).rejects.toThrow('Failed to fetch');
    expect(store.has('kaif:chunk-reload:другая')).toBe(false);
  });
});
