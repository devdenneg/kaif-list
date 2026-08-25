import { z } from 'zod';

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) =>
      typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, 'Некорректный токен бота'),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .min(3)
    .transform((v) => v.replace(/^@/, '')),

  /** Внутренний адрес API (в docker-сети это http://api:4000). */
  API_URL: z.string().url(),
  /** Публичный адрес веб-приложения — для ссылок в сообщениях. */
  APP_URL: z.string().url(),
  INTERNAL_API_SECRET: z.string().min(24),

  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  /** polling — для разработки, webhook — для продакшена. */
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  BOT_WEBHOOK_URL: z.string().url().optional(),
  BOT_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  BOT_HOST: z.string().default('0.0.0.0'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),

  /** Автоматически устанавливать вебхук при старте. */
  BOT_SET_WEBHOOK: bool(true),
});

export type BotEnv = z.infer<typeof schema>;

export function loadBotEnv(): BotEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    console.error(`\nНекорректная конфигурация бота:\n${issues}\n`);
    process.exit(1);
  }
  if (parsed.data.BOT_MODE === 'webhook' && !parsed.data.BOT_WEBHOOK_URL) {
    console.error('\nBOT_MODE=webhook требует BOT_WEBHOOK_URL\n');
    process.exit(1);
  }
  return parsed.data;
}
