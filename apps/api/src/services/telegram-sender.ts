import { Api, GrammyError, HttpError } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/**
 * Отправка сообщений в Telegram из API/воркера.
 *
 * Здесь только исходящие сообщения — входящие обновления обрабатывает
 * отдельный процесс бота. Такое разделение позволяет перезапускать бота,
 * не теряя очередь уведомлений.
 */

const api = new Api(env.TELEGRAM_BOT_TOKEN);

export interface SendOptions {
  chatId: string | bigint;
  text: string;
  /** Кнопка «Открыть задачу». */
  taskUrl?: string | null;
  /** Кнопки быстрых действий: [{text, data}]. */
  actions?: { text: string; data: string }[];
  replyToMessageId?: number;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  /** Пользователь заблокировал бота — больше не пишем. */
  blocked?: boolean;
  /** Сколько секунд подождать перед повтором (лимит Telegram). */
  retryAfter?: number;
}

export async function sendTelegramMessage(options: SendOptions): Promise<SendResult> {
  const keyboard: InlineKeyboardButton[][] = [];

  const row: InlineKeyboardButton[] = [];
  if (options.taskUrl) row.push({ text: '🔗 Открыть', url: options.taskUrl });
  for (const action of options.actions ?? []) {
    row.push({ text: action.text, callback_data: action.data });
  }
  if (row.length > 0) keyboard.push(row);

  try {
    const message = await api.sendMessage(String(options.chatId), options.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      ...(options.replyToMessageId
        ? { reply_parameters: { message_id: options.replyToMessageId } }
        : {}),
    });
    return { ok: true, messageId: message.message_id };
  } catch (error) {
    if (error instanceof GrammyError) {
      // 403 — бот заблокирован или чат удалён: помечаем и прекращаем попытки.
      if (error.error_code === 403) {
        await markBlocked(options.chatId);
        return { ok: false, blocked: true };
      }
      // 429 — превышен лимит: воркер повторит попытку позже.
      if (error.error_code === 429) {
        const retryAfter = error.parameters?.retry_after ?? 5;
        logger.warn({ retryAfter }, 'Telegram: превышен лимит сообщений');
        return { ok: false, retryAfter };
      }
      if (error.error_code === 400) {
        logger.error({ description: error.description }, 'Telegram отклонил сообщение');
        return { ok: false };
      }
    }
    if (error instanceof HttpError) {
      logger.warn({ err: error }, 'Сеть недоступна при отправке в Telegram');
      return { ok: false, retryAfter: 5 };
    }
    logger.error({ err: error }, 'Неизвестная ошибка отправки в Telegram');
    return { ok: false, retryAfter: 10 };
  }
}

async function markBlocked(chatId: string | bigint): Promise<void> {
  try {
    await prisma.user.updateMany({
      where: { botChatId: BigInt(chatId) },
      data: { botBlocked: true },
    });
    logger.info({ chatId: String(chatId) }, 'Пользователь заблокировал бота');
  } catch (error) {
    logger.error({ err: error }, 'Не удалось отметить блокировку бота');
  }
}

/**
 * Простейший ограничитель темпа: Telegram допускает около 30 сообщений в секунду.
 * Держим комфортный запас, чтобы не ловить 429 на массовых рассылках.
 */
const MIN_INTERVAL_MS = 40;
let lastSentAt = 0;

export async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastSentAt + MIN_INTERVAL_MS - now);
  lastSentAt = now + wait;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
