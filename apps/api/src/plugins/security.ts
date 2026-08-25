import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { LIMITS } from '@kaif/shared';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import { TooManyRequestsError } from '../lib/errors.js';

/** Заголовки, CORS, ограничение частоты запросов, загрузка файлов. */
export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    // API отдаёт JSON и файлы; исполняемого контента здесь быть не должно.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        sandbox: ['allow-downloads'],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Картинки-вложения показываются на домене фронтенда.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Запросы без Origin (curl, мобильные клиенты, health-checks) не блокируем:
      // защиту от CSRF обеспечивают SameSite=Strict и проверка Origin ниже.
      if (!origin) return callback(null, true);
      if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      // Не бросаем ошибку (иначе получился бы 500): просто не выдаём CORS-заголовки —
      // браузер сам не отдаст ответ чужой странице. Мутирующие запросы дополнительно
      // отсекает проверка Origin ниже.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86_400,
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET,
    parseOptions: { httpOnly: true, sameSite: 'strict', secure: env.isProduction },
  });

  await app.register(multipart, {
    limits: {
      fileSize: Math.min(env.maxUploadBytes, LIMITS.attachment.maxBytes),
      files: LIMITS.attachment.maxPerRequest,
      fields: 20,
      fieldSize: 1024 * 100,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis,
    nameSpace: 'rl:',
    // Если Redis недоступен, ограничение частоты отключается, но сервис
    // продолжает работать. Падение кеша не должно быть падением продукта.
    skipOnError: true,
    keyGenerator: (request) => {
      const user = request.currentUser;
      return user ? `u:${user.id}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: () => {
      const error = new TooManyRequestsError();
      return {
        statusCode: error.statusCode,
        error: { code: error.code, message: error.message },
      };
    },
  });

  /**
   * Дополнительная защита от CSRF: у мутирующих запросов Origin обязан
   * совпадать с разрешённым. Cookie с refresh-токеном имеет SameSite=Strict,
   * но проверка на сервере надёжнее, чем доверие браузеру.
   */
  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

    const origin = request.headers.origin;
    if (!origin) return;
    if (env.CORS_ORIGINS.includes(origin)) return;

    request.log.warn({ origin, url: request.url }, 'Запрос с недопустимого Origin');
    await reply.code(403).send({
      error: { code: 'BAD_ORIGIN', message: 'Запрос с недопустимого источника' },
    });
  });
}

/** Жёсткий лимит для чувствительных ручек авторизации. */
export const authRateLimit = {
  config: {
    rateLimit: {
      max: env.AUTH_RATE_LIMIT_MAX,
      timeWindow: env.AUTH_RATE_LIMIT_WINDOW,
    },
  },
};

/** Лимит для дорогих операций: загрузка файлов, поиск. */
export const heavyRateLimit = {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  },
};
