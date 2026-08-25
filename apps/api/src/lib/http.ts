import type { FastifyRequest } from 'fastify';
import type { RequestMeta } from '../modules/auth/service.js';

/** Метаданные запроса для аудита и сессий. */
export function requestMeta(request: FastifyRequest, deviceLabel?: string | null): RequestMeta {
  return {
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    deviceLabel: deviceLabel ?? null,
  };
}

/** Курсорная пагинация: следующий курсор — id последнего элемента. */
export function buildCursor<T extends { id: string }>(
  items: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (items.length <= limit) return { items, nextCursor: null };
  const page = items.slice(0, limit);
  return { items: page, nextCursor: page[page.length - 1]?.id ?? null };
}
