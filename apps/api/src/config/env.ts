import { z } from 'zod';

/**
 * Все переменные окружения валидируются при старте.
 * Сервер не поднимется с кривой конфигурацией — это дешевле, чем ловить
 * `undefined` в проде через неделю.
 */

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = () =>
  z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    /** Публичный адрес фронтенда — для ссылок в уведомлениях и CORS. */
    APP_URL: z.string().url(),
    /** Публичный адрес API — для ссылок на файлы. */
    API_URL: z.string().url(),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

    /** Ключ подписи access-токенов. Минимум 32 символа, только из .env. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    /**
     * Сколько живёт сессия без единого обращения.
     *
     * Окно скользящее: каждое обновление токена выдаёт новый срок, поэтому
     * у того, кто пользуется доской, сессия не кончается никогда. Значение
     * важно только для тех, кто ушёл в отпуск и не заходил вовсе.
     */
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(180),

    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, 'Некорректный токен бота'),
    TELEGRAM_BOT_USERNAME: z
      .string()
      .min(3)
      .transform((v) => v.replace(/^@/, '')),
    /** Секрет вебхука Telegram (заголовок X-Telegram-Bot-Api-Secret-Token). */
    TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),

    /**
     * Общий секрет между API и ботом. Бот ходит в API служебными ручками
     * /api/internal/*, чтобы вся бизнес-логика жила в одном месте.
     */
    INTERNAL_API_SECRET: z.string().min(24, 'INTERNAL_API_SECRET должен быть не короче 24 символов'),

    /** Telegram id, которым выдаётся SUPERADMIN при первом входе. */
    SUPERADMIN_TELEGRAM_IDS: csv(),

    STORAGE_DIR: z.string().default('./storage'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),

    /** Разрешённые Origin через запятую. По умолчанию — только APP_URL. */
    CORS_ORIGINS: csv(),
    COOKIE_DOMAIN: z.string().optional(),
    /** За обратным прокси (Caddy/nginx) — доверять X-Forwarded-*. */
    TRUST_PROXY: bool(false),

    /** Запускать фоновые воркеры в этом же процессе (удобно для одного VPS). */
    ENABLE_WORKERS: bool(true),
    /** Запускать Socket.IO в этом процессе. */
    ENABLE_REALTIME: bool(true),

    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(12),
    AUTH_RATE_LIMIT_WINDOW: z.string().default('10 minutes'),
  })
  .transform((env) => {
    const corsOrigins = env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.APP_URL];
    return {
      ...env,
      CORS_ORIGINS: corsOrigins,
      isProduction: env.NODE_ENV === 'production',
      isDevelopment: env.NODE_ENV === 'development',
      isTest: env.NODE_ENV === 'test',
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      superAdminTelegramIds: env.SUPERADMIN_TELEGRAM_IDS.map((v) => {
        try {
          return BigInt(v);
        } catch {
          return null;
        }
      }).filter((v): v is bigint => v !== null),
    };
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nНекорректная конфигурация окружения:\n${issues}\n`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = loadEnv();
