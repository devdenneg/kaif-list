import { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * Небольшое состояние диалога в Redis.
 *
 * Когда бот просит написать причину или комментарий, он запоминает,
 * к какому сообщению это относится. Память процесса не подходит:
 * бот может перезапуститься между вопросом и ответом.
 */

export interface PendingAction {
  kind: 'comment' | 'move-reason' | 'new-task';
  /** Для комментария и переноса — задача, для новой задачи — доска. */
  taskId: string;
  taskKey?: string;
  toColumn?: string;
}

const TTL_SECONDS = 30 * 60;

export class BotState {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redis.on('error', (error) => logger.error({ err: error }, 'Ошибка Redis в боте'));
  }

  private key(chatId: number | string, messageId: number): string {
    return `bot:pending:${chatId}:${messageId}`;
  }

  async setPending(
    chatId: number | string,
    messageId: number,
    action: PendingAction,
  ): Promise<void> {
    await this.redis.set(this.key(chatId, messageId), JSON.stringify(action), 'EX', TTL_SECONDS);
  }

  async getPending(chatId: number | string, messageId: number): Promise<PendingAction | null> {
    const raw = await this.redis.get(this.key(chatId, messageId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingAction;
    } catch {
      return null;
    }
  }

  async clearPending(chatId: number | string, messageId: number): Promise<void> {
    await this.redis.del(this.key(chatId, messageId));
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
