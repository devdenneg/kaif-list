import { describe, expect, it } from 'vitest';
import { dayRangeInTimeZone, startOfDayInTimeZone } from './notifications.js';

/**
 * «Сегодня» — понятие личное.
 *
 * Реальная жалоба: на карточке значок «Сегодня», а вкладка «Сегодня» пустая.
 * Сервер считал сутки по своему часовому поясу: в час ночи по Москве
 * по UTC ещё вчерашний день, и задача в окно не попадала.
 */
describe('границы суток по часовому поясу', () => {
  it('полночь в Москве наступает раньше, чем в UTC', () => {
    // 25 августа 22:00 UTC — это уже 26 августа 01:00 в Москве.
    const now = new Date('2026-08-25T22:00:00Z');

    const moscow = startOfDayInTimeZone(now, 'Europe/Moscow');
    const utc = startOfDayInTimeZone(now, 'UTC');

    expect(moscow.toISOString()).toBe('2026-08-25T21:00:00.000Z');
    expect(utc.toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('срок 26 августа 09:00 по Москве попадает в московское «сегодня»', () => {
    const now = new Date('2026-08-25T22:00:00Z');
    const due = new Date('2026-08-26T06:00:00Z');

    const { start, end } = dayRangeInTimeZone(now, 'Europe/Moscow');
    expect(due >= start && due < end).toBe(true);

    // А по UTC та же задача — уже завтрашняя, из-за чего вкладка и пустела.
    const utc = dayRangeInTimeZone(now, 'UTC');
    expect(due >= utc.start && due < utc.end).toBe(false);
  });

  it('сутки длятся ровно день, когда часы не переводят', () => {
    const { start, end } = dayRangeInTimeZone(new Date('2026-08-25T12:00:00Z'), 'Europe/Moscow');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('в день перевода часов сутки короче или длиннее', () => {
    // Переход на летнее время в Берлине: 29 марта 2026 года.
    const { start, end } = dayRangeInTimeZone(new Date('2026-03-29T10:00:00Z'), 'Europe/Berlin');
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it('неизвестный часовой пояс не роняет расчёт', () => {
    const now = new Date('2026-08-25T22:00:00Z');
    expect(() => startOfDayInTimeZone(now, 'Нет/Такого')).not.toThrow();
  });
});
