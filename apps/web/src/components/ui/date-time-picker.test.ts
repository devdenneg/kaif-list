import { describe, expect, it } from 'vitest';
import { getZonedDateTimeParts, zonedDateTimeToIso } from './date-time-picker';

describe('конвертация даты и времени с часовым поясом', () => {
  it('не зависит от часового пояса устройства для Europe/Moscow', () => {
    const result = zonedDateTimeToIso(
      { year: 2026, month: 8, day: 26, hour: 18, minute: 0 },
      'Europe/Moscow',
    );

    expect(result).toEqual({ ok: true, iso: '2026-08-26T15:00:00.000Z' });
    if (!result.ok) return;
    expect(getZonedDateTimeParts(new Date(result.iso), 'Europe/Moscow')).toEqual({
      year: 2026,
      month: 8,
      day: 26,
      hour: 18,
      minute: 0,
      second: 0,
    });
  });

  it('корректно переводит локальную границу года в ISO', () => {
    const result = zonedDateTimeToIso(
      { year: 2027, month: 1, day: 1, hour: 0, minute: 30 },
      'Europe/Moscow',
    );

    expect(result).toEqual({ ok: true, iso: '2026-12-31T21:30:00.000Z' });
  });

  it('отклоняет несуществующее время во время DST-перехода', () => {
    const result = zonedDateTimeToIso(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      'America/New_York',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Такого времени нет');
  });
});
