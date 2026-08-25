import type { FastifyInstance } from 'fastify';
import {
  addBoardMemberSchema,
  bulkTaskActionSchema,
  changeBoardMemberRoleSchema,
  createBoardGroupSchema,
  createBoardInviteSchema,
  createBoardSchema,
  createLabelSchema,
  createSavedViewSchema,
  createTaskSchema,
  deleteBoardSchema,
  taskFiltersSchema,
  transferOwnershipSchema,
  updateBoardSchema,
  setBoardGroupMembersSchema,
  setMemberGroupsSchema,
  updateBoardGroupSchema,
  updateColumnSchema,
  updateLabelSchema,
  updateSavedViewSchema,
  type ColumnKey,
} from '@kaif/shared';
import { z } from 'zod';
import { createBoardInvite, listBoardInvites, revokeBoardInvite } from './invites.js';
import { requireUser } from '../../plugins/auth.js';
import { assertCan, loadBoardContext } from '../../lib/rbac.js';
import { columnKeySchema } from '@kaif/shared';
import {
  addMember,
  changeMemberRole,
  createBoard,
  createBoardGroup,
  createLabel,
  deleteBoardGroup,
  listBoardGroups,
  setBoardGroupMembers,
  setMemberGroups,
  updateBoardGroup,
  deleteBoard,
  deleteLabel,
  getBoard,
  listBoards,
  memberWorkload,
  removeMember,
  setBoardArchived,
  toggleFavorite,
  transferOwnership,
  updateBoard,
  updateColumn,
  updateLabel,
} from './service.js';
import { createTask, getBoardTasks, listBoardTasks } from '../tasks/service.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../views/service.js';
import { bulkTaskAction } from '../tasks/bulk.js';
import { boardAnalytics } from './analytics.js';
import { listBoardActivity } from '../activity/service.js';

const boardParams = z.object({ boardId: z.string().min(1).max(40) });

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireProfile);

  // ── Доски ────────────────────────────────────────────────────────────────

  app.get('/', async (request, reply) => {
    const user = requireUser(request);
    const query = z
      .object({ includeArchived: z.coerce.boolean().default(false) })
      .parse(request.query);
    return reply.send({ items: await listBoards(user, query) });
  });

  app.post('/', async (request, reply) => {
    const user = requireUser(request);
    const input = createBoardSchema.parse(request.body);
    const board = await createBoard(user, input);
    return reply.code(201).send({ board });
  });

  app.get('/:boardId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    return reply.send({ board: await getBoard(user, boardId) });
  });

  app.patch('/:boardId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = updateBoardSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ board: await updateBoard(user, context, input) });
  });

  app.post('/:boardId/archive', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ board: await setBoardArchived(user, context, archived) });
  });

  app.delete('/:boardId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { confirm } = deleteBoardSchema.parse(request.body ?? {});
    const context = await loadBoardContext(user, boardId);
    await deleteBoard(user, context, confirm);
    return reply.send({ success: true });
  });

  app.post('/:boardId/transfer-ownership', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = transferOwnershipSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({
      board: await transferOwnership(user, context, input.newOwnerId, input.confirm),
    });
  });

  app.post('/:boardId/favorite', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { favorite } = z.object({ favorite: z.boolean() }).parse(request.body);
    const context = await loadBoardContext(user, boardId);
    await toggleFavorite(user, context.board.id, favorite);
    return reply.send({ success: true });
  });

  // ── Участники ────────────────────────────────────────────────────────────

  app.get('/:boardId/members', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const board = await getBoard(user, boardId);
    return reply.send({ items: board.members });
  });

  app.get('/:boardId/workload', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const context = await loadBoardContext(user, boardId);
    assertCan(user, context, 'board.analytics.view');
    return reply.send({ items: await memberWorkload(context) });
  });

  app.post('/:boardId/members', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = addBoardMemberSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    const member = await addMember(user, context, input.userId, input.role);
    return reply.code(201).send({ member });
  });

  app.patch('/:boardId/members/:userId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(request.params);
    const { role } = changeBoardMemberRoleSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ member: await changeMemberRole(user, context, userId, role) });
  });

  app.delete('/:boardId/members/:userId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadBoardContext(user, boardId);
    await removeMember(user, context, userId);
    return reply.send({ success: true });
  });

  /** Группы конкретного человека — обратная сторона состава группы. */
  app.put('/:boardId/members/:userId/groups', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(request.params);
    const { groupIds } = setMemberGroupsSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ items: await setMemberGroups(user, context, userId, groupIds) });
  });

  // ── Пригласительные ссылки ───────────────────────────────────────────────

  app.get('/:boardId/invites', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ items: await listBoardInvites(user, context) });
  });

  app.post('/:boardId/invites', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = createBoardInviteSchema.parse(request.body ?? {});
    const context = await loadBoardContext(user, boardId);
    return reply.code(201).send({ invite: await createBoardInvite(user, context, input) });
  });

  app.delete('/:boardId/invites/:inviteId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { inviteId } = z.object({ inviteId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadBoardContext(user, boardId);
    await revokeBoardInvite(user, context, inviteId);
    return reply.send({ success: true });
  });

  // ── Рабочие группы ───────────────────────────────────────────────────────

  app.get('/:boardId/groups', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ items: await listBoardGroups(user, context) });
  });

  app.post('/:boardId/groups', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = createBoardGroupSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.code(201).send({ group: await createBoardGroup(user, context, input) });
  });

  app.patch('/:boardId/groups/:groupId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { groupId } = z.object({ groupId: z.string().min(1).max(40) }).parse(request.params);
    const input = updateBoardGroupSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ group: await updateBoardGroup(user, context, groupId, input) });
  });

  app.put('/:boardId/groups/:groupId/members', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { groupId } = z.object({ groupId: z.string().min(1).max(40) }).parse(request.params);
    const { userIds } = setBoardGroupMembersSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ group: await setBoardGroupMembers(user, context, groupId, userIds) });
  });

  app.delete('/:boardId/groups/:groupId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { groupId } = z.object({ groupId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadBoardContext(user, boardId);
    await deleteBoardGroup(user, context, groupId);
    return reply.send({ success: true });
  });

  // ── Метки и колонки ──────────────────────────────────────────────────────

  app.post('/:boardId/labels', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = createLabelSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.code(201).send({ label: await createLabel(user, context, input) });
  });

  app.patch('/:boardId/labels/:labelId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { labelId } = z.object({ labelId: z.string().min(1).max(40) }).parse(request.params);
    const input = updateLabelSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ label: await updateLabel(user, context, labelId, input) });
  });

  app.delete('/:boardId/labels/:labelId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { labelId } = z.object({ labelId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadBoardContext(user, boardId);
    await deleteLabel(user, context, labelId);
    return reply.send({ success: true });
  });

  app.patch('/:boardId/columns/:columnKey', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { columnKey } = z.object({ columnKey: columnKeySchema }).parse(request.params);
    const input = updateColumnSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    await updateColumn(user, context, columnKey as ColumnKey, input);
    return reply.send({ success: true });
  });

  // ── Задачи доски ─────────────────────────────────────────────────────────

  /** Канбан: задачи, сгруппированные по колонкам. */
  app.get('/:boardId/tasks', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const filters = taskFiltersSchema.parse(request.query ?? {});
    const context = await loadBoardContext(user, boardId);
    return reply.send({ columns: await getBoardTasks(context, filters) });
  });

  /** Плоский список с фильтрами и пагинацией: бэклог, поиск, таблица. */
  app.get('/:boardId/tasks/list', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const filters = taskFiltersSchema.parse(request.query ?? {});
    const context = await loadBoardContext(user, boardId);
    return reply.send(await listBoardTasks(context, filters));
  });

  app.post('/:boardId/tasks', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = createTaskSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.code(201).send({ task: await createTask(user, context, input) });
  });

  app.post('/:boardId/tasks/bulk', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = bulkTaskActionSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send(await bulkTaskAction(user, context, input));
  });

  // ── Сохранённые фильтры ──────────────────────────────────────────────────

  app.get('/:boardId/views', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ items: await listSavedViews(user, context) });
  });

  app.post('/:boardId/views', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const input = createSavedViewSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.code(201).send({ view: await createSavedView(user, context, input) });
  });

  app.patch('/:boardId/views/:viewId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { viewId } = z.object({ viewId: z.string().min(1).max(40) }).parse(request.params);
    const input = updateSavedViewSchema.parse(request.body);
    const context = await loadBoardContext(user, boardId);
    return reply.send({ view: await updateSavedView(user, context, viewId, input) });
  });

  app.delete('/:boardId/views/:viewId', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { viewId } = z.object({ viewId: z.string().min(1).max(40) }).parse(request.params);
    const context = await loadBoardContext(user, boardId);
    await deleteSavedView(user, context, viewId);
    return reply.send({ success: true });
  });

  // ── Выгрузка ─────────────────────────────────────────────────────────────


  // ── Аналитика и активность ───────────────────────────────────────────────

  app.get('/:boardId/analytics', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }).parse(
      request.query ?? {},
    );
    const context = await loadBoardContext(user, boardId);
    assertCan(user, context, 'board.analytics.view');
    return reply.send({ analytics: await boardAnalytics(context, days) });
  });

  app.get('/:boardId/activity', async (request, reply) => {
    const user = requireUser(request);
    const { boardId } = boardParams.parse(request.params);
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query ?? {});
    const context = await loadBoardContext(user, boardId);
    return reply.send(await listBoardActivity(context.board.id, query));
  });
}
