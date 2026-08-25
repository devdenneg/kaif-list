import './bootstrap.js';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { buildServer } from './server.js';
import { prisma } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';
import { ensureStorageDirs } from './lib/files.js';
import { setupRealtime, shutdownRealtime } from './realtime/index.js';
import { closeQueues, registerRepeatableJobs } from './queue/index.js';
import { startWorkers, stopWorkers } from './queue/workers/index.js';

/**
 * Точка входа API.
 *
 * По умолчанию в этом же процессе работают Socket.IO и фоновые воркеры —
 * для одного VPS это самый простой и надёжный вариант. При росте нагрузки
 * их можно разнести по процессам, ничего не меняя в коде: события ходят
 * через Redis, а очереди и так распределённые.
 */
async function main(): Promise<void> {
  await ensureStorageDirs();

  const app = await buildServer();

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info(`API слушает http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);

  if (env.ENABLE_REALTIME) {
    await setupRealtime(app.server);
  }

  if (env.ENABLE_WORKERS) {
    startWorkers();
    await registerRepeatableJobs();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Получен ${signal}, завершаем работу…`);

    const timeout = setTimeout(() => {
      logger.error('Штатное завершение затянулось — выходим принудительно');
      process.exit(1);
    }, 15_000);
    timeout.unref();

    try {
      await shutdownRealtime();
      await stopWorkers();
      await app.close();
      await closeQueues();
      await prisma.$disconnect();
      await closeRedis();
      logger.info('Остановлено штатно');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Ошибка при остановке');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Необработанное отклонение промиса');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Необработанное исключение');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Не удалось запустить API');
  process.exit(1);
});
