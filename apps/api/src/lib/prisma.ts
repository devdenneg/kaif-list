import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Единственный экземпляр клиента на процесс.
 * В dev переживает hot-reload через глобальную ссылку.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

prisma.$on('error' as never, (event: unknown) => {
  logger.error({ event }, 'Ошибка Prisma');
});

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;
}
