import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  archiveTaskSchema,
  createChecklistItemSchema,
  createChecklistSchema,
  createCommentSchema,
  createTaskLinkSchema,
  deleteTaskSchema,
  listCommentsSchema,
  moveTaskSchema,
  updateChecklistItemSchema,
  updateCommentSchema,
  updateTaskSchema,
  toggleReactionSchema,
  duplicateTaskSchema,
  watchTaskSchema,
} from '@kaif/shared';
import { requireUser } from '../../plugins/auth.js';
import { loadTaskContext } from '../../lib/rbac.js';
import { heavyRateLimit } from '../../plugins/security.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../lib/errors.js';
import { deleteTask, getTaskDetail, setTaskArchived, updateTask } from './service.js';
import { moveTask } from './move.js';
import { duplicateTask } from './duplicate.js';
import { setTaskWatching } from './watch.js';
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  deleteChecklistItem,
  updateChecklistItem,
} from './checklists.js';
import { createTaskLink, deleteTaskLink } from './links.js';
import {
  createComment,
  deleteComment,
  listComments,
  listReplies,
  toggleReaction,
  updateComment,
} from '../comments/service.js';
import { listTaskActivity } from '../activity/service.js';
import { readMultipartFile, uploadAttachment } from '../attachments/service.js';

const taskParams = z.object({ taskId: z.string().min(1).max(40) });

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireProfile);

  app.get('/:taskId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    return reply.send({ task: await getTaskDetail(user, taskId) });
  });

  app.patch('/:taskId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const input = updateTaskSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.send({ task: await updateTask(user, context, input) });
  });

  app.post('/:taskId/move', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const input = moveTaskSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.send({ task: await moveTask(user, context, input) });
  });

  app.post('/:taskId/archive', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const body = z
      .object({ archived: z.boolean().default(true) })
      .merge(archiveTaskSchema)
      .parse(request.body ?? {});
    const context = await loadTaskContext(user, taskId);
    return reply.send({
      task: await setTaskArchived(user, context, body.archived, body.reason),
    });
  });

  app.delete('/:taskId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { confirm } = deleteTaskSchema.parse(request.body ?? {});
    const context = await loadTaskContext(user, taskId);
    await deleteTask(user, context, confirm);
    return reply.send({ success: true });
  });

  app.post('/:taskId/duplicate', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const input = duplicateTaskSchema.parse(request.body ?? {});
    const context = await loadTaskContext(user, taskId);
    return reply.code(201).send({ task: await duplicateTask(user, context, input) });
  });

  app.post('/:taskId/watch', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { watch } = watchTaskSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    await setTaskWatching(user, context, watch);
    return reply.send({ success: true, watching: watch });
  });

  // ── Комментарии ──────────────────────────────────────────────────────────

  app.get('/:taskId/comments', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const query = listCommentsSchema.parse(request.query ?? {});
    const context = await loadTaskContext(user, taskId);
    return reply.send(await listComments(context, query, user.id));
  });

  app.post('/:taskId/comments', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const input = createCommentSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.code(201).send({ comment: await createComment(user, context, input) });
  });

  app.get('/:taskId/comments/:commentId/replies', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { commentId } = z.object({ commentId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadTaskContext(user, taskId);
    return reply.send({ items: await listReplies(context, commentId, user.id) });
  });

  app.patch('/:taskId/comments/:commentId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { commentId } = z.object({ commentId: z.string().min(1).max(40) }).parse(request.params);
    const { body } = updateCommentSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.send({ comment: await updateComment(user, context, commentId, body) });
  });

  app.post('/:taskId/comments/:commentId/reactions', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { commentId } = z.object({ commentId: z.string().min(1).max(40) }).parse(request.params);
    const { emoji } = toggleReactionSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.send({ comment: await toggleReaction(user, context, commentId, emoji) });
  });

  app.delete('/:taskId/comments/:commentId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { commentId } = z.object({ commentId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadTaskContext(user, taskId);
    await deleteComment(user, context, commentId);
    return reply.send({ success: true });
  });

  // ── Чек-листы ────────────────────────────────────────────────────────────

  app.post('/:taskId/checklists', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { title } = createChecklistSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    const id = await createChecklist(user, context, title);
    return reply.code(201).send({ id, task: await getTaskDetail(user, taskId) });
  });

  app.delete('/:taskId/checklists/:checklistId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { checklistId } = z
      .object({ checklistId: z.string().min(1).max(40) })
      .parse(request.params);
    const context = await loadTaskContext(user, taskId);
    await deleteChecklist(user, context, checklistId);
    return reply.send({ task: await getTaskDetail(user, taskId) });
  });

  app.post('/:taskId/checklists/:checklistId/items', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { checklistId } = z
      .object({ checklistId: z.string().min(1).max(40) })
      .parse(request.params);
    const input = createChecklistItemSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    await addChecklistItem(user, context, checklistId, input);
    return reply.code(201).send({ task: await getTaskDetail(user, taskId) });
  });

  app.patch('/:taskId/checklist-items/:itemId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { itemId } = z.object({ itemId: z.string().min(1).max(40) }).parse(request.params);
    const input = updateChecklistItemSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    await updateChecklistItem(user, context, itemId, input);
    return reply.send({ task: await getTaskDetail(user, taskId) });
  });

  app.delete('/:taskId/checklist-items/:itemId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { itemId } = z.object({ itemId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadTaskContext(user, taskId);
    await deleteChecklistItem(user, context, itemId);
    return reply.send({ task: await getTaskDetail(user, taskId) });
  });

  // ── Связи ────────────────────────────────────────────────────────────────

  app.post('/:taskId/links', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const input = createTaskLinkSchema.parse(request.body);
    const context = await loadTaskContext(user, taskId);
    return reply.code(201).send({ link: await createTaskLink(user, context, input) });
  });

  app.delete('/:taskId/links/:linkId', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const { linkId } = z.object({ linkId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadTaskContext(user, taskId);
    await deleteTaskLink(user, context, linkId);
    return reply.send({ success: true });
  });

  // ── История задачи ───────────────────────────────────────────────────────

  app.get('/:taskId/activity', async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query ?? {});
    const context = await loadTaskContext(user, taskId);
    return reply.send(await listTaskActivity(context.task.id, query));
  });

  // ── Вложения задачи ──────────────────────────────────────────────────────

  app.post('/:taskId/attachments', heavyRateLimit, async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = taskParams.parse(request.params);
    const context = await loadTaskContext(user, taskId);

    const uploaded = [];
    const files = request.files();
    for await (const part of files) {
      const buffer = await readMultipartFile(part.file, env.maxUploadBytes);
      if (part.file.truncated) throw new BadRequestError('Файл превышает допустимый размер');
      uploaded.push(
        await uploadAttachment(
          user,
          { buffer, filename: part.filename, mimetype: part.mimetype },
          { taskId: context.task.id, boardId: context.board.id },
        ),
      );
    }

    if (uploaded.length === 0) throw new BadRequestError('Не передано ни одного файла');
    return reply.code(201).send({ items: uploaded });
  });
}
