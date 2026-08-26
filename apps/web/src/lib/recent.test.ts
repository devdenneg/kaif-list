import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecent, readRecent, rememberRecent } from './recent';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe('недавно открытое', () => {
  it('свежее идёт первым', () => {
    rememberRecent({ type: 'task', key: 'KAIF-1', title: 'Первая' });
    rememberRecent({ type: 'task', key: 'KAIF-2', title: 'Вторая' });

    expect(readRecent().map((item) => item.key)).toEqual(['KAIF-2', 'KAIF-1']);
  });

  it('повторное открытие не плодит строки, а поднимает наверх', () => {
    rememberRecent({ type: 'task', key: 'KAIF-1', title: 'Первая' });
    rememberRecent({ type: 'board', key: 'KAIF', title: 'Доска' });
    rememberRecent({ type: 'task', key: 'KAIF-1', title: 'Первая' });

    const items = readRecent();
    expect(items).toHaveLength(2);
    expect(items[0]?.key).toBe('KAIF-1');
  });

  it('задача и доска с одинаковым ключом — разные строки', () => {
    rememberRecent({ type: 'board', key: 'KAIF', title: 'Доска' });
    rememberRecent({ type: 'task', key: 'KAIF', title: 'Задача' });

    expect(readRecent()).toHaveLength(2);
  });

  it('список не растёт бесконечно', () => {
    for (let index = 0; index < 20; index += 1) {
      rememberRecent({ type: 'task', key: `KAIF-${index}`, title: 'Задача' });
    }
    expect(readRecent()).toHaveLength(7);
  });

  it('мусор в хранилище не роняет палитру', () => {
    store.set('kaif:recent', '{ это не список }');
    expect(readRecent()).toEqual([]);

    store.set('kaif:recent', JSON.stringify([{ type: 'нечто' }, null, 42]));
    expect(readRecent()).toEqual([]);
  });

  it('историю можно очистить', () => {
    rememberRecent({ type: 'task', key: 'KAIF-1', title: 'Первая' });
    clearRecent();
    expect(readRecent()).toEqual([]);
  });
});
