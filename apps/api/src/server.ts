import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerSecurity } from './plugins/security.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerBoardRoutes } from './modules/boards/routes.js';
import { registerTaskRoutes } from './modules/tasks/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerInternalRoutes } from './modules/internal/routes.js';
import { registerSearchRoutes } from './modules/search/routes.js';
import { registerAttachmentRoutes, registerFileRoutes } from './modules/attachments/routes.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // Приводим к базовому типу, иначе дженерики инстанса «протекают» во все модули.
    loggerInstance: logger as FastifyBaseLogger,
    /**
     * Доверяем ровно одному прокси — своему Caddy.
     *
     * С `trustProxy: true` Fastify берёт крайний левый элемент X-Forwarded-For,
     * а его подставляет сам клиент: в журнал безопасности попадали бы
     * выдуманные адреса, и разбор инцидента опирался бы на подделку.
     * Функция возвращает true только для непосредственного соседа.
     */
    trustProxy: env.TRUST_PROXY ? (_address: string, hop: number) => hop === 0 : false,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: false } },
  });

  registerErrorHandler(app);
  await registerSecurity(app);
  registerAuth(app);

  // ── Служебные ручки (нужны балансировщику и мониторингу) ──
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return reply.send({ status: 'ready' });
    } catch (error) {
      logger.error({ err: error }, 'Проверка готовности не пройдена');
      return reply.code(503).send({ status: 'not-ready' });
    }
  });

  // ── Прикладные маршруты ──
  await app.register(registerAuthRoutes, { prefix: '/api/auth' });
  await app.register(registerUserRoutes, { prefix: '/api/users' });
  await app.register(registerBoardRoutes, { prefix: '/api/boards' });
  await app.register(registerTaskRoutes, { prefix: '/api/tasks' });
  await app.register(registerNotificationRoutes, { prefix: '/api/notifications' });
  await app.register(registerSearchRoutes, { prefix: '/api/search' });
  await app.register(registerAttachmentRoutes, { prefix: '/api/attachments' });
  await app.register(registerFileRoutes, { prefix: '/api/files' });
  await app.register(registerAdminRoutes, { prefix: '/api/admin' });
  await app.register(registerInternalRoutes, { prefix: '/api/internal' });

  return app;
}
