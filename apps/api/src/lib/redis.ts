import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Подключения к Redis.
 *
 * Важная деталь: у основного клиента команды НЕ должны копиться в офлайн-очереди.
 * Иначе при падении Redis каждый HTTP-запрос повисает навсегда, ожидая ответа
 * от лимитера частоты. Лучше быстро получить ошибку и деградировать —
 * Redis у нас кеш и координатор, а не источник истины.
 *
 * BullMQ, наоборот, требует `maxRetriesPerRequest: null` и офлайн-очередь,
 * поэтому для очередей создаются отдельные соединения с другими настройками.
 */

function createMainClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    // Команда завершится ошибкой после пары попыток, а не зависнет.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  attachLogging(client, 'main');
  return client;
}

function attachLogging(client: Redis, role: string): void {
  let reported = false;
  client.on('error', (error) => {
    // Логируем первую ошибку подробно, дальше — только смену состояния,
    // иначе при недоступном Redis лог заливается одинаковыми строками.
    if (!reported) {
      logger.error({ err: error, role }, 'Ошибка Redis');
      reported = true;
    }
  });
  client.on('ready', () => {
    if (reported) logger.info({ role }, 'Redis снова доступен');
    reported = false;
  });
}

/** Основной клиент: кеш, счётчики, presence, защита от повторов. */
export const redis = createMainClient();

/**
 * Отдельные соединения для BullMQ и адаптера Socket.IO (блокирующие команды).
 * Подключаются лениво: импорт модуля не должен открывать сокеты.
 */
export function createRedisConnection(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  attachLogging(client, role);
  return client;
}

const REPLAY_PREFIX = 'replay:';
const REVOKED_PREFIX = 'revoked-session:';

/**
 * Защита от повторного использования подписи Telegram.
 * Возвращает true, если значение видим впервые.
 *
 * При недоступном Redis отвечаем `false` — то есть отказываем во входе.
 * Это осознанно: без защиты от повтора подписанные данные Telegram можно
 * переиспользовать, а вход через бота (основной способ) при этом продолжает работать.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const result = await redis.set(`${REPLAY_PREFIX}${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (error) {
    logger.error({ err: error }, 'Redis недоступен при проверке повторного входа');
    return false;
  }
}

/**
 * Денилист отозванных сессий — мгновенный разлогин без ожидания истечения JWT.
 * Это оптимизация: источник истины — поле `revokedAt` в таблице сессий,
 * которое проверяется тем же запросом. Поэтому при сбое Redis безопасно
 * пропустить проверку.
 */
export async function markSessionRevoked(sessionId: string, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(`${REVOKED_PREFIX}${sessionId}`, '1', 'EX', Math.max(ttlSeconds, 60));
  } catch (error) {
    logger.warn({ err: error, sessionId }, 'Не удалось пометить сессию отозванной в Redis');
  }
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    return (await redis.get(`${REVOKED_PREFIX}${sessionId}`)) !== null;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
