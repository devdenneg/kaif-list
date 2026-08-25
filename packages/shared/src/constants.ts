/** Числовые и строковые ограничения домена. Используются и в zod-схемах, и в UI. */

export const LIMITS = {
  boardName: { min: 2, max: 64 },
  boardKey: { min: 2, max: 8 },
  boardDescription: { max: 2000 },
  taskTitle: { min: 3, max: 200 },
  taskDescriptionText: { max: 50_000 },
  commentText: { min: 1, max: 20_000 },
  labelName: { min: 1, max: 32 },
  checklistTitle: { min: 1, max: 120 },
  checklistItem: { min: 1, max: 300 },
  displayName: { min: 2, max: 48 },
  reason: { min: 10, max: 2000 },
  storyPoints: { min: 0, max: 999 },
  estimateMinutes: { min: 0, max: 60 * 24 * 365 },
  attachment: {
    maxBytes: 25 * 1024 * 1024,
    maxPerRequest: 10,
    maxPerTask: 50,
  },
  avatar: {
    maxBytes: 5 * 1024 * 1024,
    size: 256,
  },
  pagination: {
    defaultLimit: 50,
    maxLimit: 200,
  },
  search: { minQuery: 2, max: 100 },
} as const;

/** Ключ доски: латиница в верхнем регистре и цифры, начинается с буквы. `OPS`, `DEV2`. */
export const BOARD_KEY_REGEX = /^[A-Z][A-Z0-9]{1,7}$/;

/** Ключ задачи целиком: `OPS-128`. */
export const TASK_KEY_REGEX = /^([A-Z][A-Z0-9]{1,7})-(\d{1,7})$/;

/**
 * Поиск ключей задач внутри текста.
 *
 * Возвращается новый объект: глобальные регулярки хранят `lastIndex`,
 * и общий экземпляр на два вызова — классический источник плавающих багов.
 */
export function taskKeyScanner(): RegExp {
  return /\b[A-Z][A-Z0-9]{1,7}-\d{1,7}\b/g;
}

/** HEX-цвет лейбла/доски. */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Палитра лейблов — заранее подобранная, читаемая и в тёмной, и в светлой теме. */
export const LABEL_COLORS: readonly string[] = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#64748b',
];

export const BOARD_COLORS: readonly string[] = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#64748b',
];

/**
 * Разрешённые MIME-типы вложений. Проверяются по сигнатуре файла, а не по заголовку.
 * SVG намеренно исключён: он умеет исполнять скрипты и является вектором XSS.
 */
export const ALLOWED_ATTACHMENT_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  'video/mp4',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
];

export const IMAGE_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
];

/** Время жизни токенов и кодов. */
export const TTL = {
  accessTokenSeconds: 15 * 60,
  refreshTokenDays: 30,
  loginCodeSeconds: 120,
  loginCodePollIntervalMs: 2000,
  telegramAuthMaxAgeSeconds: 300,
  replayCacheSeconds: 600,
} as const;

/**
 * Набор реакций на комментарии. Намеренно короткий: «понял», «сделаю»,
 * «спасибо» не должны быть отдельными сообщениями и засорять обсуждение,
 * но и превращать задачу в чат со стикерами тоже не нужно.
 */
export const REACTION_EMOJI = ['👍', '👀', '🔥', '🎉', '✅', '❤️', '😄', '😕'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** Часовой пояс по умолчанию — большинство команды в Москве. */
export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_LOCALE = 'ru';
