import { describe, expect, it } from 'vitest';
import {
  cn,
  colorFromString,
  formatBytes,
  formatDuration,
  formatRelative,
  fromDateTimeLocal,
  initials,
  toDateTimeLocal,
} from './utils';

describe('склейка классов', () => {
  it('последний конфликтующий класс побеждает', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('игнорирует ложные значения', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
});

describe('аватары', () => {
  it('инициалы из имени и фамилии', () => {
    expect(initials('Ирина Смирнова')).toBe('ИС');
    expect(initials('Павел')).toBe('П');
    expect(initials('  ')).toBe('?');
  });

  it('цвет стабилен для одного и того же id', () => {
    expect(colorFromString('user-1')).toBe(colorFromString('user-1'));
    expect(colorFromString('user-1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('форматирование', () => {
  it('размер файла', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(2048)).toBe('2 КБ');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
  });

  it('длительность', () => {
    expect(formatDuration(30)).toBe('30 мин');
    expect(formatDuration(60)).toBe('1 ч');
    expect(formatDuration(150)).toBe('2 ч 30 мин');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(null)).toBe('');
  });

  it('относительное время', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 30_000))).toBe('только что');
    expect(formatRelative(new Date(now - 10 * 60_000))).toContain('мин назад');
    expect(formatRelative(null)).toBe('');
  });
});

describe('значения полей даты', () => {
  it('туда и обратно без потери минут', () => {
    const iso = new Date('2026-03-10T15:30:00').toISOString();
    const local = toDateTimeLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = fromDateTimeLocal(local);
    expect(back && new Date(back).getMinutes()).toBe(30);
  });

  it('пустые значения не ломают', () => {
    expect(toDateTimeLocal(null)).toBe('');
    expect(toDateTimeLocal('не дата')).toBe('');
    expect(fromDateTimeLocal('')).toBeNull();
  });
});
