import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { trimmedString } from './common.js';

/** Запрос одноразового кода для входа через бота. */
export const requestLoginCodeSchema = z.object({
  /** Опциональная метка устройства для списка сессий. */
  deviceLabel: z.string().max(120).optional(),
});

export const loginCodeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Некорректный код входа'),
});

/** Данные Telegram Login Widget. Подпись проверяется на сервере. */
export const telegramWidgetAuthSchema = z.object({
  id: z.union([z.number(), z.string()]),
  first_name: z.string().max(128).optional(),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().url().max(512).optional(),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string().regex(/^[a-f0-9]{64}$/i, 'Некорректная подпись'),
});
export type TelegramWidgetAuthInput = z.infer<typeof telegramWidgetAuthSchema>;

/** Данные Telegram Mini App: сырая строка initData. */
export const telegramMiniAppAuthSchema = z.object({
  initData: z.string().min(10).max(4096),
});

/** Завершение профиля: имя и аватар обязательны сразу после привязки Telegram. */
export const completeProfileSchema = z.object({
  displayName: trimmedString(LIMITS.displayName.min, LIMITS.displayName.max, 'Имя'),
  /** Ключ уже загруженного файла аватара либо URL из Telegram. */
  avatarUrl: z.string().max(512).nullable().optional(),
  /** Использовать фотографию из Telegram. */
  useTelegramPhoto: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
  locale: z.enum(['ru', 'en']).optional(),
});
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

/** Подтверждение или отклонение входа из Telegram. */
export const confirmLoginSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Некорректный код входа'),
  approve: z.boolean(),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().min(8).max(40),
});
