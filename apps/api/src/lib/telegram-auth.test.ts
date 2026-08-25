import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMiniAppInitData, verifyWidgetAuth, buildDisplayName } from './telegram-auth.js';

const BOT_TOKEN = '1234567890:AAHfaketokenfaketokenfaketokenfaketoken';

function signWidget(payload: Record<string, string | number>): Record<string, string | number> {
  const dataCheckString = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return { ...payload, hash };
}

function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

describe('Telegram Login Widget', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  const authDate = Math.floor(now.getTime() / 1000);

  it('принимает корректную подпись', () => {
    const payload = signWidget({
      id: 123456789,
      first_name: 'Ирина',
      last_name: 'Смирнова',
      username: 'irina',
      auth_date: authDate,
    });

    const result = verifyWidgetAuth(payload, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.telegramId).toBe(123456789n);
      expect(result.data.username).toBe('irina');
    }
  });

  it('отклоняет подделанные данные', () => {
    const payload = signWidget({ id: 1, auth_date: authDate });
    // Меняем id уже после подписи — подпись становится недействительной.
    const tampered = { ...payload, id: 999 };
    const result = verifyWidgetAuth(tampered, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('отклоняет просроченные данные', () => {
    const payload = signWidget({ id: 1, auth_date: authDate - 3600 });
    const result = verifyWidgetAuth(payload, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXPIRED');
  });

  it('отклоняет данные из будущего', () => {
    const payload = signWidget({ id: 1, auth_date: authDate + 600 });
    const result = verifyWidgetAuth(payload, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('FUTURE_AUTH_DATE');
  });

  it('отклоняет мусор вместо хеша', () => {
    const result = verifyWidgetAuth({ id: 1, auth_date: authDate, hash: 'нет' }, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_HASH_FORMAT');
  });

  it('подпись чужим токеном не проходит', () => {
    const payload = signWidget({ id: 1, auth_date: authDate });
    const result = verifyWidgetAuth(payload, '999:другойтокендлиннееТридцатиСимволовААА', 300, now);
    expect(result.ok).toBe(false);
  });

  it('http-ссылку на фото не принимаем', () => {
    const payload = signWidget({
      id: 1,
      auth_date: authDate,
      photo_url: 'http://evil.example/x.jpg',
    });
    const result = verifyWidgetAuth(payload, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.photoUrl).toBeNull();
  });
});

describe('Telegram Mini App', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  const authDate = String(Math.floor(now.getTime() / 1000));

  it('принимает корректный initData', () => {
    const initData = signInitData({
      auth_date: authDate,
      query_id: 'AAE',
      user: JSON.stringify({ id: 42, first_name: 'Павел', username: 'pavel' }),
    });

    const result = verifyMiniAppInitData(initData, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.telegramId).toBe(42n);
      expect(result.data.firstName).toBe('Павел');
    }
  });

  it('отклоняет изменённые поля', () => {
    const initData = signInitData({
      auth_date: authDate,
      user: JSON.stringify({ id: 42 }),
    });

    // Подменяем пользователя, оставляя исходную подпись.
    const params = new URLSearchParams(initData);
    params.set('user', JSON.stringify({ id: 43 }));
    const tampered = params.toString();
    expect(tampered).not.toBe(initData);

    const result = verifyMiniAppInitData(tampered, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('требует поле user', () => {
    const initData = signInitData({ auth_date: authDate });
    const result = verifyMiniAppInitData(initData, BOT_TOKEN, 300, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_USER');
  });
});

describe('отображаемое имя', () => {
  const base = {
    telegramId: 1n,
    firstName: null,
    lastName: null,
    username: null,
    photoUrl: null,
    languageCode: null,
    authDate: new Date(),
    hash: '',
  };

  it('склеивает имя и фамилию', () => {
    expect(buildDisplayName({ ...base, firstName: 'Ирина', lastName: 'Смирнова' })).toBe(
      'Ирина Смирнова',
    );
  });

  it('падает обратно на username', () => {
    expect(buildDisplayName({ ...base, username: 'irina' })).toBe('irina');
  });

  it('всегда возвращает что-то непустое', () => {
    expect(buildDisplayName({ ...base, telegramId: 987654n }).length).toBeGreaterThan(0);
  });
});
