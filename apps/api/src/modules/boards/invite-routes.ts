import type { FastifyInstance } from 'fastify';
import { inviteTokenSchema } from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { acceptInvite, previewInvite } from './invites.js';

/**
 * Вход по пригласительной ссылке. Живёт отдельно от досок: человек ещё не
 * участник, поэтому обычные проверки доступа к доске тут не применимы.
 * Авторизация всё равно обязательна — сначала вход через Telegram, потом доска.
 */
export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/:token', { preHandler: app.requireProfile }, async (request, reply) => {
    const user = requireUser(request);
    const { token } = inviteTokenSchema.parse(request.params);
    return reply.send({ invite: await previewInvite(user, token) });
  });

  app.post('/:token/accept', { preHandler: app.requireProfile }, async (request, reply) => {
    const user = requireUser(request);
    const { token } = inviteTokenSchema.parse(request.params);
    return reply.send(await acceptInvite(user, token));
  });
}
