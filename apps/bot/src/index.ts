import './bootstrap.js';

import http from 'node:http';
import { Bot, webhookCallback } from 'grammy';
import { loadBotEnv } from './config.js';
import { logger } from './logger.js';
import { InternalApi } from './api.js';
import { BotState } from './state.js';
import { registerHandlers } from './handlers.js';

/**
 * Процесс бота обрабатывает только ВХОДЯЩИЕ обновления Telegram.
 * Исходящие уведомления рассылает воркер внутри API — так перезапуск бота
 * не влияет на очередь уведомлений, и наоборот.
 */
async function main(): Promise<void> {
  const env = loadBotEnv();
  const api = new InternalApi(env);
  const state = new BotState(env.REDIS_URL);
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Пользователь заблокировал или разблокировал бота.
  // Регистрируем до запуска: grammY не принимает middleware после start().
  bot.on('my_chat_member', async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    const chatId = ctx.chat.id;
    try {
      if (status === 'kicked' || status === 'left') {
        await api.setBlocked(String(chatId), true);
        logger.info({ chatId }, 'Бот заблокирован пользователем');
      } else if (status === 'member') {
        await api.setBlocked(String(chatId), false);
      }
    } catch (error) {
      logger.warn({ err: error }, 'Не удалось обновить статус блокировки');
    }
  });

  registerHandlers(bot, env, api, state);

  await bot.api.setMyCommands([
    { command: 'tasks', description: 'Мои активные задачи' },
    { command: 'today', description: 'Что горит сегодня' },
    { command: 'testing', description: 'Задачи на моём тестировании' },
    { command: 'me', description: 'Мой профиль' },
    { command: 'settings', description: 'Настройки уведомлений' },
    { command: 'help', description: 'Справка' },
  ]);

  let server: http.Server | null = null;

  if (env.BOT_MODE === 'webhook') {
    const secretPath = `/telegram/${env.TELEGRAM_WEBHOOK_SECRET ?? 'webhook'}`;
    const handle = webhookCallback(bot, 'http', {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    });

    server = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.method !== 'POST' || req.url !== secretPath) {
        res.writeHead(404).end();
        return;
      }
      void handle(req, res).catch((error: unknown) => {
        logger.error({ err: error }, 'Ошибка обработки вебхука');
        if (!res.headersSent) res.writeHead(500).end();
      });
    });

    await new Promise<void>((resolve) => server?.listen(env.BOT_PORT, env.BOT_HOST, resolve));
    logger.info(`Бот слушает вебхук на ${env.BOT_HOST}:${env.BOT_PORT}${secretPath}`);

    if (env.BOT_SET_WEBHOOK && env.BOT_WEBHOOK_URL) {
      const url = `${env.BOT_WEBHOOK_URL.replace(/\/$/, '')}${secretPath}`;
      await bot.api.setWebhook(url, {
        ...(env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: env.TELEGRAM_WEBHOOK_SECRET } : {}),
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      });
      logger.info(`Вебхук установлен: ${url}`);
    }
  } else {
    // Long polling: удобно в разработке, вебхук при этом надо снять.
    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => undefined);
    void bot.start({
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      onStart: (info) => logger.info(`Бот @${info.username} запущен (long polling)`),
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Получен ${signal}, останавливаем бота…`);
    try {
      if (env.BOT_MODE === 'polling') await bot.stop();
      if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
      await state.close();
      logger.info('Бот остановлен');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при остановке бота');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ err: reason }, 'Необработанное отклонение промиса'),
  );
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Не удалось запустить бота');
  process.exit(1);
});
