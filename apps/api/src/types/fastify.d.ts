import type { RequestUser } from '../lib/rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Заполняется хуком авторизации. */
    currentUser: RequestUser | null;
  }

  interface FastifyInstance {
    /** preHandler: требует валидный access-токен. */
    authenticate: import('fastify').preHandlerHookHandler;
    /** preHandler: требует токен + завершённый онбординг (имя и аватар). */
    requireProfile: import('fastify').preHandlerHookHandler;
    /** preHandler: только для суперадминов. */
    requireSuperAdmin: import('fastify').preHandlerHookHandler;
  }
}

export {};
