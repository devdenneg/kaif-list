import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, InternalError } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * Единый формат ошибки для всего API:
 * `{ error: { code, message, fields?, reasonRequired?, requestId } }`.
 * Наружу никогда не уходят стек-трейсы и детали БД.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Маршрут ${request.method} ${request.url} не найден`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // Валидация zod — отдаём ошибки по полям, чтобы форма подсветила их сама.
    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) {
        const path = issue.path.join('.') || 'root';
        if (!fields[path]) fields[path] = issue.message;
      }
      request.log.debug({ fields }, 'Ошибка валидации');
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте правильность заполнения полей',
          fields,
          requestId: request.id,
        },
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'Прикладная ошибка');
      } else {
        request.log.debug({ code: error.code, msg: error.message }, 'Отказ в операции');
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Внутренняя ошибка сервера',
          ...(error.fields ? { fields: error.fields } : {}),
          ...(error.meta ?? {}),
          requestId: request.id,
        },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      request.log.warn({ code: error.code, meta: error.meta }, 'Ошибка запроса к БД');
      if (error.code === 'P2002') {
        return reply.code(409).send({
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Такая запись уже существует',
            requestId: request.id,
          },
        });
      }
      if (error.code === 'P2025') {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Запись не найдена', requestId: request.id },
        });
      }
      if (error.code === 'P2003') {
        return reply.code(400).send({
          error: {
            code: 'INVALID_REFERENCE',
            message: 'Ссылка на несуществующую запись',
            requestId: request.id,
          },
        });
      }
    }

    // Ошибки самого Fastify (лимит размера тела, некорректный JSON и т. п.).
    const fallback = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = fallback.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      request.log.debug({ err: error }, 'Клиентская ошибка');
      return reply.code(statusCode).send({
        error: {
          code: fallback.code ?? 'BAD_REQUEST',
          message: fallback.message ?? 'Некорректный запрос',
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, 'Необработанная ошибка');
    const internal = new InternalError();
    return reply.code(500).send({
      error: {
        code: internal.code,
        message: env.isProduction ? internal.message : (fallback.message ?? internal.message),
        requestId: request.id,
      },
    });
  });
}
