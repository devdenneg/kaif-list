import {
  ActivityType,
  NotificationType,
  SOCKET_EVENTS,
  extractMentionIds,
  rooms,
  toPreview,
  type CommentDto,
  type CreateCommentInput,
} from '@kaif/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { commentSelect, mapComment } from '../../lib/mappers.js';
import { assertCanTask, checkTask, type RequestUser, type TaskContext } from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification, taskRecipients } from '../../services/notify.js';
import { ensureContributor } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { attachUploads } from '../tasks/service.js';

export async function listComments(
  context: TaskContext,
  options: { cursor?: string; limit: number; order: 'asc' | 'desc'; includeSystem: boolean },
  currentUserId?: string,
): Promise<{ items: CommentDto[]; nextCursor: string | null }> {
  const comments = await prisma.comment.findMany({
    where: {
      taskId: context.task.id,
      parentId: null,
      ...(options.includeSystem ? {} : { kind: 'USER' }),
    },
    orderBy: [{ createdAt: options.order }, { id: options.order }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: commentSelect,
  });

  const hasMore = comments.length > options.limit;
  const page = hasMore ? comments.slice(0, options.limit) : comments;

  return {
    items: page.map((comment) => mapComment(comment, currentUserId)),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function listReplies(
  context: TaskContext,
  parentId: string,
  currentUserId?: string,
): Promise<CommentDto[]> {
  const replies = await prisma.comment.findMany({
    where: { taskId: context.task.id, parentId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: commentSelect,
  });
  return replies.map((comment) => mapComment(comment, currentUserId));
}

/**
 * Создание комментария.
 *
 * Здесь работает правило: кто написал в задачу — тот становится её
 * контрибьютором и дальше получает уведомления, даже если не был
 * ни автором, ни исполнителем, ни тестировщиком.
 */
export async function createComment(
  user: RequestUser,
  context: TaskContext,
  input: CreateCommentInput,
): Promise<CommentDto> {
  assertCanTask(user, context, 'comment.create');
  if (
    !context.board.settings.allowViewerComments &&
    context.membershipRole === 'VIEWER' &&
    !context.isSuperAdmin
  ) {
    throw new ForbiddenError('Комментарии для наблюдателей отключены на этой доске');
  }

  const { doc, text } = sanitizeRichText(input.body, { required: true });
  if (!doc) throw new BadRequestError('Пустой комментарий');

  if (input.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: input.parentId, taskId: context.task.id },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new BadRequestError('Комментарий, на который вы отвечаете, не найден');
    // Треды одноуровневые: ответ на ответ прикрепляем к корню.
    if (parent.parentId) input = { ...input, parentId: parent.parentId };
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        taskId: context.task.id,
        authorId: user.id,
        kind: 'USER',
        bodyJson: doc as unknown as Prisma.InputJsonValue,
        bodyText: text,
        parentId: input.parentId ?? null,
      },
      select: { id: true },
    });

    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await attachUploads(tx, input.attachmentIds, user.id, {
        commentId: created.id,
        taskId: context.task.id,
        boardId: context.board.id,
      });
    }

    await tx.task.update({
      where: { id: context.task.id },
      data: { commentCount: { increment: 1 }, lastActivityAt: new Date() },
    });

    // Автор комментария становится участником задачи.
    await ensureContributor(tx, context.task.id, user.id);

    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.COMMENT_CREATED,
      payload: { commentId: created.id, preview: toPreview(doc, 120) },
    });

    return tx.comment.findUniqueOrThrow({ where: { id: created.id }, select: commentSelect });
  });

  const dto = mapComment(comment, user.id);

  await publishRealtime([
    {
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.COMMENT_CREATED,
      data: { boardId: context.board.id, taskId: context.task.id, commentId: dto.id, comment: dto },
    },
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: {
        boardId: context.board.id,
        taskId: context.task.id,
        actorId: user.id,
        fields: ['commentCount'],
      },
    },
  ]);

  await notifyAboutComment(user, context, dto, doc);

  return dto;
}

async function notifyAboutComment(
  user: RequestUser,
  context: TaskContext,
  comment: CommentDto,
  doc: unknown,
): Promise<void> {
  const preview = toPreview(doc, 200);
  const basePayload = {
    taskKey: context.task.key,
    taskTitle: context.task.title,
    boardName: context.board.name,
    actorName: user.displayName,
    commentPreview: preview,
    commentId: comment.id,
  };

  // Упомянутые получают персональное уведомление и становятся контрибьюторами.
  const mentionIds = extractMentionIds(doc);
  let mentioned: string[] = [];
  if (mentionIds.length > 0) {
    const members = await prisma.boardMember.findMany({
      where: { boardId: context.board.id, userId: { in: mentionIds } },
      select: { userId: true },
    });
    mentioned = members.map((m) => m.userId).filter((id) => id !== user.id);

    if (mentioned.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const userId of mentioned) await ensureContributor(tx, context.task.id, userId);
      });
      await dispatchNotification({
        type: NotificationType.MENTIONED,
        recipientIds: mentioned,
        actorId: user.id,
        boardId: context.board.id,
        taskId: context.task.id,
        payload: basePayload,
      });
    }
  }

  const recipients = (await taskRecipients(context.task.id, { excludeUserId: user.id })).filter(
    (id) => !mentioned.includes(id),
  );
  if (recipients.length > 0) {
    await dispatchNotification({
      type: NotificationType.COMMENT_ADDED,
      recipientIds: recipients,
      actorId: user.id,
      boardId: context.board.id,
      taskId: context.task.id,
      payload: basePayload,
    });
  }
}

export async function updateComment(
  user: RequestUser,
  context: TaskContext,
  commentId: string,
  body: unknown,
): Promise<CommentDto> {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId: context.task.id },
    select: { id: true, authorId: true, kind: true, deletedAt: true },
  });
  if (!comment || comment.deletedAt) throw new NotFoundError('Комментарий не найден');
  if (comment.kind === 'SYSTEM') {
    throw new ForbiddenError('Системные записи нельзя редактировать', 'SYSTEM_COMMENT');
  }

  assertCanTask(user, context, 'comment.update', { isOwnResource: comment.authorId === user.id });

  const { doc, text } = sanitizeRichText(body, { required: true });

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: {
      bodyJson: doc as unknown as Prisma.InputJsonValue,
      bodyText: text,
      editedAt: new Date(),
    },
    select: commentSelect,
  });

  const dto = mapComment(updated, user.id);
  await publishRealtime({
    room: rooms.task(context.task.id),
    event: SOCKET_EVENTS.COMMENT_UPDATED,
    data: { boardId: context.board.id, taskId: context.task.id, commentId, comment: dto },
  });

  return dto;
}

export async function deleteComment(
  user: RequestUser,
  context: TaskContext,
  commentId: string,
): Promise<void> {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId: context.task.id },
    select: { id: true, authorId: true, kind: true, deletedAt: true },
  });
  if (!comment || comment.deletedAt) throw new NotFoundError('Комментарий не найден');
  if (comment.kind === 'SYSTEM' && !checkTask(user, context, 'board.settings.manage')) {
    throw new ForbiddenError('Системные записи удалять нельзя', 'SYSTEM_COMMENT');
  }

  assertCanTask(user, context, 'comment.delete', { isOwnResource: comment.authorId === user.id });

  await prisma.$transaction(async (tx) => {
    // Мягкое удаление: тред не рассыпается, история остаётся честной.
    await tx.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), bodyJson: Prisma.DbNull, bodyText: '' },
    });
    await tx.task.update({
      where: { id: context.task.id },
      data: { commentCount: { decrement: 1 } },
    });
    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.COMMENT_DELETED,
      payload: { commentId },
    });
  });

  await publishRealtime({
    room: rooms.task(context.task.id),
    event: SOCKET_EVENTS.COMMENT_DELETED,
    data: { boardId: context.board.id, taskId: context.task.id, commentId },
  });
}

/**
 * Поставить или снять реакцию.
 *
 * Смысл в том, чтобы короткое «понял» не становилось отдельным сообщением:
 * обсуждение задачи должно читаться, а не пролистываться.
 * Уведомление на реакцию намеренно не отправляется — иначе это снова спам.
 */
export async function toggleReaction(
  user: RequestUser,
  context: TaskContext,
  commentId: string,
  emoji: string,
): Promise<CommentDto> {
  assertCanTask(user, context, 'comment.create');

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId: context.task.id, deletedAt: null },
    select: { id: true },
  });
  if (!comment) throw new NotFoundError('Комментарий не найден');

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId, userId: user.id, emoji } },
    select: { id: true },
  });

  if (existing) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.commentReaction.create({ data: { commentId, userId: user.id, emoji } });
  }

  const updated = await prisma.comment.findUniqueOrThrow({
    where: { id: commentId },
    select: commentSelect,
  });
  const dto = mapComment(updated, user.id);

  await publishRealtime({
    room: rooms.task(context.task.id),
    event: SOCKET_EVENTS.COMMENT_UPDATED,
    data: { boardId: context.board.id, taskId: context.task.id, commentId, comment: dto },
  });

  return dto;
}
