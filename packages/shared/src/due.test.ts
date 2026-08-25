import { describe, expect, it } from 'vitest';
import { getDueState, formatDueRelative, dateKeyInTimeZone, plural } from './index.js';

const now = new Date('2026-03-10T12:00:00Z');
const options = { now, timeZone: 'Europe/Moscow' };

describe('состояние дедлайна', () => {
  it('без срока — none', () => {
    expect(getDueState(null, options)).toBe('none');
    expect(getDueState(undefined, options)).toBe('none');
  });

  it('завершённая задача не подсвечивается', () => {
    expect(getDueState('2026-01-01T00:00:00Z', { ...options, completed: true })).toBe('done');
  });

  it('прошедший срок — overdue', () => {
    expect(getDueState('2026-03-10T11:59:00Z', options)).toBe('overdue');
  });

  it('сегодня по таймзоне пользователя', () => {
    // 20:00 по Москве = ещё сегодня.
    expect(getDueState('2026-03-10T17:00:00Z', options)).toBe('today');
  });

  it('меньше суток — soon', () => {
    expect(getDueState('2026-03-11T10:00:00Z', options)).toBe('soon');
  });

  it('до трёх дней — upcoming', () => {
    expect(getDueState('2026-03-12T12:00:00Z', options)).toBe('upcoming');
  });

  it('дальше — normal', () => {
    expect(getDueState('2026-04-01T12:00:00Z', options)).toBe('normal');
  });

  it('некорректная дата не ломает расчёт', () => {
    expect(getDueState('не дата', options)).toBe('none');
  });
});

describe('форматирование срока', () => {
  it('будущее', () => {
    expect(formatDueRelative('2026-03-10T14:00:00Z', now)).toContain('через');
  });

  it('прошлое', () => {
    expect(formatDueRelative('2026-03-09T12:00:00Z', now)).toContain('просрочено');
  });
});

describe('вспомогательное', () => {
  it('ключ даты учитывает таймзону', () => {
    // 23:30 UTC — это уже следующий день в Москве.
    expect(dateKeyInTimeZone(new Date('2026-03-10T23:30:00Z'), 'Europe/Moscow')).toBe('2026-03-11');
    expect(dateKeyInTimeZone(new Date('2026-03-10T23:30:00Z'), 'UTC')).toBe('2026-03-10');
  });

  it('склонение числительных', () => {
    expect(plural(1, 'день', 'дня', 'дней')).toBe('день');
    expect(plural(2, 'день', 'дня', 'дней')).toBe('дня');
    expect(plural(5, 'день', 'дня', 'дней')).toBe('дней');
    expect(plural(11, 'день', 'дня', 'дней')).toBe('дней');
    expect(plural(21, 'день', 'дня', 'дней')).toBe('день');
  });
});
