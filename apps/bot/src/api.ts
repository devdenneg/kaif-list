import type { BotEnv } from './config.js';
import { logger } from './logger.js';

/**
 * Клиент служебного API.
 *
 * Бот сознательно не ходит в базу напрямую: вся бизнес-логика
 * (права, участники, обязательные причины, уведомления) живёт в API.
 * Бот — только интерфейс в Telegram.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class InternalApi {
  constructor(private readonly env: BotEnv) {}

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.env.API_URL.replace(/\/$/, '')}/api/internal${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.env.INTERNAL_API_SECRET,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      logger.error({ err: error, path }, 'API недоступен');
      throw new ApiError(503, 'API_UNREACHABLE', 'Сервис временно недоступен');
    }

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const errorBody = payload.error as
        | { code?: string; message?: string; [key: string]: unknown }
        | undefined;
      throw new ApiError(
        response.status,
        errorBody?.code ?? 'UNKNOWN',
        errorBody?.message ?? 'Ошибка запроса',
        errorBody,
      );
    }

    return payload as T;
  }

  link(input: {
    telegramId: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
    languageCode?: string | null;
    chatId: string;
    code?: string;
  }) {
    return this.request<{
      user: { id: string; displayName: string; profileCompleted: boolean; globalRole: string };
      loginApproved: boolean;
      loginError: string | null;
    }>('POST', '/telegram/link', { body: input });
  }

  me(chatId: string) {
    return this.request<{
      user: {
        id: string;
        displayName: string;
        profileCompleted: boolean;
        globalRole: string;
        timezone: string;
      };
    }>('GET', '/telegram/me', { query: { chatId } });
  }

  tasks(chatId: string, scope: 'active' | 'today' | 'overdue' | 'testing', limit = 10) {
    return this.request<{
      items: {
        id: string;
        key: string;
        title: string;
        columnKey: string;
        priority: string;
        dueDate: string | null;
        boardName: string;
      }[];
    }>('GET', '/telegram/tasks', { query: { chatId, scope, limit } });
  }

  comment(chatId: string, taskId: string, text: string) {
    return this.request<{ commentId: string; taskKey: string }>('POST', '/telegram/comment', {
      body: { chatId, taskId, text },
    });
  }

  move(chatId: string, taskId: string, toColumn: string, reason?: string) {
    return this.request<{ task: { key: string; columnKey: string } }>('POST', '/telegram/move', {
      body: { chatId, taskId, toColumn, ...(reason ? { reason } : {}) },
    });
  }

  setBlocked(chatId: string, blocked: boolean) {
    return this.request<{ success: boolean }>('POST', '/telegram/blocked', {
      body: { chatId, blocked },
    });
  }

  setPreferences(chatId: string, preferences: Record<string, unknown>) {
    return this.request<{ preferences: Record<string, unknown> }>('POST', '/telegram/prefs', {
      body: { chatId, preferences },
    });
  }

  getPreferences(chatId: string) {
    return this.request<{ preferences: Record<string, unknown> }>('GET', '/telegram/prefs', {
      query: { chatId },
    });
  }

  logout(chatId: string) {
    return this.request<{ success: boolean }>('POST', '/telegram/logout', { body: { chatId } });
  }

  task(chatId: string, taskId: string) {
    return this.request<{ task: Record<string, unknown> }>('GET', `/telegram/task/${taskId}`, {
      query: { chatId },
    });
  }
}
