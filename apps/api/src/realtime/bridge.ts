import { createRedisConnection, redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Мост между бизнес-логикой и Socket.IO.
 *
 * События публикуются в Redis, а слой сокетов их слушает и рассылает по комнатам.
 * Благодаря этому воркеры и API могут жить как в одном процессе, так и в разных —
 * код отправки события при этом не меняется.
 */

const CHANNEL = 'kaif:realtime';

export interface RealtimeEvent {
  room: string;
  event: string;
  data: unknown;
}

export async function publishRealtime(events: RealtimeEvent | RealtimeEvent[]): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  try {
    await redis.publish(CHANNEL, JSON.stringify(list));
  } catch (error) {
    logger.warn({ err: error }, 'Не удалось опубликовать реалтайм-событие');
  }
}

export function subscribeRealtime(handler: (event: RealtimeEvent) => void): () => Promise<void> {
  const subscriber = createRedisConnection('realtime-sub');
  void subscriber.subscribe(CHANNEL).catch((error) => {
    logger.error({ err: error }, 'Не удалось подписаться на канал реалтайма');
  });

  subscriber.on('message', (_channel, message) => {
    try {
      const events = JSON.parse(message) as RealtimeEvent[];
      for (const event of events) handler(event);
    } catch (error) {
      logger.warn({ err: error }, 'Некорректное реалтайм-событие');
    }
  });

  return async () => {
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  };
}
