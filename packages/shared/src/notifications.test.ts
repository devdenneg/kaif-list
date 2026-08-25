import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationType,
  isNotificationAllowed,
  isQuietHours,
  mergeNotificationPreferences,
  shouldDeliverToTelegram,
} from './index.js';

describe('настройки уведомлений', () => {
  it('по умолчанию всё включено', () => {
    const prefs = mergeNotificationPreferences(undefined);
    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(isNotificationAllowed(NotificationType.COMMENT_ADDED, prefs)).toBe(true);
  });

  it('отключённый тип не проходит', () => {
    const prefs = mergeNotificationPreferences({
      disabledTypes: [NotificationType.COMMENT_ADDED],
    });
    expect(isNotificationAllowed(NotificationType.COMMENT_ADDED, prefs)).toBe(false);
  });

  it('упоминание нельзя отключить', () => {
    const prefs = mergeNotificationPreferences({
      disabledTypes: [NotificationType.MENTIONED],
      onlyMine: true,
      telegramEnabled: true,
    });
    expect(isNotificationAllowed(NotificationType.MENTIONED, prefs)).toBe(true);
  });

  it('режим «только моё» отсекает чужую активность', () => {
    const prefs = mergeNotificationPreferences({ onlyMine: true });
    expect(isNotificationAllowed(NotificationType.COMMENT_ADDED, prefs)).toBe(false);
    expect(isNotificationAllowed(NotificationType.TASK_ASSIGNED_TO_YOU, prefs)).toBe(true);
  });
});

describe('тихие часы', () => {
  const prefs = mergeNotificationPreferences({
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '09:00',
  });

  it('ночью — тишина', () => {
    expect(isQuietHours(prefs, 'UTC', new Date('2026-03-10T23:30:00Z'))).toBe(true);
    expect(isQuietHours(prefs, 'UTC', new Date('2026-03-10T03:00:00Z'))).toBe(true);
  });

  it('днём — можно', () => {
    expect(isQuietHours(prefs, 'UTC', new Date('2026-03-10T12:00:00Z'))).toBe(false);
  });

  it('выключенные тихие часы не срабатывают', () => {
    const off = mergeNotificationPreferences({ quietHoursEnabled: false });
    expect(isQuietHours(off, 'UTC', new Date('2026-03-10T23:30:00Z'))).toBe(false);
  });

  it('срочное всё равно доставляется ночью', () => {
    const night = new Date('2026-03-10T23:30:00Z');
    expect(shouldDeliverToTelegram(NotificationType.COMMENT_ADDED, prefs, 'UTC', night)).toBe(false);
    expect(shouldDeliverToTelegram(NotificationType.MENTIONED, prefs, 'UTC', night)).toBe(true);
  });

  it('при выключенном Telegram не доставляем ничего', () => {
    const off = mergeNotificationPreferences({ telegramEnabled: false });
    expect(
      shouldDeliverToTelegram(NotificationType.COMMENT_ADDED, off, 'UTC', new Date()),
    ).toBe(false);
  });
});
