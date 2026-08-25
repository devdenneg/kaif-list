import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, tryResolveUser } from '../../plugins/auth.js';
import { heavyRateLimit } from '../../plugins/security.js';
import { env } from '../../config/env.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { avatarFilePath, isInlineSafe, storedFilePath, thumbFilePath } from '../../lib/files.js';
import {
  deleteAttachment,
  readMultipartFile,
  resolveAttachment,
  uploadAttachment,
} from './service.js';

const idParams = z.object({ id: z.string().min(8).max(40) });
const tokenQuery = z.object({ t: z.string().max(200).optional() });

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Загрузка «в никуда»: файл создаётся со статусом PENDING и привязывается
   * к задаче или комментарию при их сохранении. Так работает вставка картинок
   * в редактор описания до того, как задача вообще создана.
   */
  app.post(
    '/',
    { preHandler: app.requireProfile, ...heavyRateLimit },
    async (request, reply) => {
      const user = requireUser(request);
      const query = z
        .object({ boardId: z.string().min(1).max(40).optional(), taskId: z.string().min(1).max(40).optional() })
        .parse(request.query ?? {});

      const uploaded = [];
      for await (const part of request.files()) {
        const buffer = await readMultipartFile(part.file, env.maxUploadBytes);
        if (part.file.truncated) throw new BadRequestError('Файл превышает допустимый размер');
        uploaded.push(
          await uploadAttachment(
            user,
            { buffer, filename: part.filename, mimetype: part.mimetype },
            { boardId: query.boardId, taskId: query.taskId },
          ),
        );
      }

      if (uploaded.length === 0) throw new BadRequestError('Не передано ни одного файла');
      return reply.code(201).send({ items: uploaded });
    },
  );

  /**
   * Скачивание. Доступ даёт либо подписанная ссылка (`?t=`), либо
   * авторизованный пользователь с правом видеть задачу.
   */
  app.get('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { t } = tokenQuery.parse(request.query ?? {});
    const user = await tryResolveUser(request);
    const attachment = await resolveAttachment(id, { user, ...(t ? { token: t } : {}) });

    const filePath = storedFilePath(attachment.storedName);
    await assertFileExists(filePath);

    const disposition = isInlineSafe(attachment.mime) ? 'inline' : 'attachment';
    return reply
      .header('Content-Type', attachment.mime)
      .header(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      )
      .header('Content-Length', attachment.size)
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(createReadStream(filePath));
  });

  app.get('/:id/thumb', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { t } = tokenQuery.parse(request.query ?? {});
    const user = await tryResolveUser(request);
    const attachment = await resolveAttachment(id, { user, ...(t ? { token: t } : {}) });
    if (!attachment.thumbName) throw new NotFoundError('Превью недоступно');

    const filePath = thumbFilePath(attachment.thumbName);
    await assertFileExists(filePath);

    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=604800, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(filePath));
  });

  app.delete('/:id', { preHandler: app.requireProfile }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParams.parse(request.params);
    await deleteAttachment(user, id);
    return reply.send({ success: true });
  });
}

/** Аватары: имена файлов случайные и неугадываемые, поэтому отдаём без авторизации. */
export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/avatars/:name', async (request, reply) => {
    const { name } = z
      .object({ name: z.string().regex(/^[a-f0-9]{24,64}\.[a-z0-9]{1,8}$/) })
      .parse(request.params);

    const filePath = avatarFilePath(name);
    await assertFileExists(filePath);

    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=604800, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(filePath));
  });
}

async function assertFileExists(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    throw new NotFoundError('Файл не найден на диске', 'FILE_MISSING');
  }
}
