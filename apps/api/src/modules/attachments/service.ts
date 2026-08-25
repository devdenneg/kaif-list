import {
  ActivityType,
  LIMITS,
  NotificationType,
  SOCKET_EVENTS,
  rooms,
  type AttachmentDto,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors.js';
import { deleteStoredFile, storeAttachment } from '../../lib/files.js';
import { attachmentSelect, mapAttachment } from '../../lib/mappers.js';
import {
  assertCan,
  assertCanTask,
  loadBoardContext,
  loadTaskContext,
  type RequestUser,
} from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification, taskRecipients } from '../../services/notify.js';
import { ensureContributor } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { verifyFileToken } from '../../lib/file-tokens.js';

/** Незакреплённые загрузки живут сутки, затем удаляются фоновой job'ой. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export async function uploadAttachment(
  user: RequestUser,
  file: UploadInput,
  target: { boardId?: string; taskId?: string },
): Promise<AttachmentDto> {
  let boardId = target.boardId ?? null;

  if (target.taskId) {
    const context = await loadTaskContext(user, target.taskId);
    assertCanTask(user, context, 'attachment.create');
    boardId = context.board.id;

    const existing = await prisma.attachment.count({
      where: { taskId: context.task.id, status: 'ATTACHED' },
    });
    if (existing >= LIMITS.attachment.maxPerTask) {
      throw new ConflictError(
        `К задаче можно приложить не более ${LIMITS.attachment.maxPerTask} файлов`,
      );
    }
  } else if (boardId) {
    const context = await loadBoardContext(user, boardId);
    assertCan(user, context, 'attachment.create');
    boardId = context.board.id;
  }

  const stored = await storeAttachment(file.buffer, file.filename, file.mimetype);

  const attachment = await prisma.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: {
        boardId,
        taskId: target.taskId ?? null,
        uploaderId: user.id,
        status: target.taskId ? 'ATTACHED' : 'PENDING',
        filename: stored.filename,
        storedName: stored.storedName,
        mime: stored.mime,
        size: stored.size,
        checksum: stored.checksum,
        width: stored.width,
        height: stored.height,
        thumbName: stored.thumbName,
        expiresAt: target.taskId ? null : new Date(Date.now() + PENDING_TTL_MS),
      },
      select: attachmentSelect,
    });

    if (target.taskId) {
      await tx.task.update({
        where: { id: target.taskId },
        data: { attachmentCount: { increment: 1 }, lastActivityAt: new Date() },
      });
      await ensureContributor(tx, target.taskId, user.id);
      await recordActivity(tx, {
        boardId: boardId as string,
        taskId: target.taskId,
        actorId: user.id,
        type: ActivityType.ATTACHMENT_ADDED,
        payload: { filename: stored.filename, size: stored.size },
      });
    }

    return created;
  });

  if (target.taskId && boardId) {
    await publishRealtime([
      {
        room: rooms.task(target.taskId),
        event: SOCKET_EVENTS.ATTACHMENT_CHANGED,
        data: { boardId, taskId: target.taskId, actorId: user.id },
      },
      {
        room: rooms.board(boardId),
        event: SOCKET_EVENTS.TASK_UPDATED,
        data: { boardId, taskId: target.taskId, actorId: user.id, fields: ['attachments'] },
      },
    ]);

    const context = await loadTaskContext(user, target.taskId);
    const recipients = await taskRecipients(target.taskId, { excludeUserId: user.id });
    if (recipients.length > 0) {
      await dispatchNotification({
        type: NotificationType.ATTACHMENT_ADDED,
        recipientIds: recipients,
        actorId: user.id,
        boardId,
        taskId: target.taskId,
        payload: {
          taskKey: context.task.key,
          taskTitle: context.task.title,
          boardName: context.board.name,
          actorName: user.displayName,
          filename: stored.filename,
        },
      });
    }
  }

  return mapAttachment(attachment);
}

export interface DownloadTarget {
  storedName: string;
  thumbName: string | null;
  filename: string;
  mime: string;
  size: number;
}

/**
 * Доступ к файлу: либо подписанная ссылка, либо авторизованный пользователь
 * с правом видеть задачу. Оба пути проверяются на сервере.
 */
export async function resolveAttachment(
  attachmentId: string,
  options: { user: RequestUser | null; token?: string },
): Promise<DownloadTarget> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storedName: true,
      thumbName: true,
      filename: true,
      mime: true,
      size: true,
      taskId: true,
      boardId: true,
      uploaderId: true,
      status: true,
    },
  });
  if (!attachment) throw new NotFoundError('Файл не найден');

  const target: DownloadTarget = {
    storedName: attachment.storedName,
    thumbName: attachment.thumbName,
    filename: attachment.filename,
    mime: attachment.mime,
    size: attachment.size,
  };

  if (options.token && verifyFileToken(attachmentId, options.token)) return target;

  const user = options.user;
  if (!user) throw new ForbiddenError('Нет доступа к файлу', 'FILE_FORBIDDEN');

  if (attachment.uploaderId === user.id) return target;

  if (attachment.taskId) {
    // Бросит 404/403, если у пользователя нет доступа к задаче.
    await loadTaskContext(user, attachment.taskId);
    return target;
  }
  if (attachment.boardId) {
    await loadBoardContext(user, attachment.boardId);
    return target;
  }

  throw new ForbiddenError('Нет доступа к файлу', 'FILE_FORBIDDEN');
}

export async function deleteAttachment(user: RequestUser, attachmentId: string): Promise<void> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storedName: true,
      thumbName: true,
      taskId: true,
      boardId: true,
      uploaderId: true,
      filename: true,
    },
  });
  if (!attachment) throw new NotFoundError('Файл не найден');

  if (attachment.taskId) {
    const context = await loadTaskContext(user, attachment.taskId);
    assertCanTask(user, context, 'attachment.delete', {
      isOwnResource: attachment.uploaderId === user.id,
    });
  } else if (attachment.uploaderId !== user.id) {
    throw new ForbiddenError('Можно удалять только свои файлы');
  }

  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });
    if (attachment.taskId) {
      await tx.task.update({
        where: { id: attachment.taskId },
        data: { attachmentCount: { decrement: 1 } },
      });
      await recordActivity(tx, {
        boardId: attachment.boardId as string,
        taskId: attachment.taskId,
        actorId: user.id,
        type: ActivityType.ATTACHMENT_REMOVED,
        payload: { filename: attachment.filename },
      });
    }
  });

  await deleteStoredFile(attachment.storedName, attachment.thumbName);

  if (attachment.taskId && attachment.boardId) {
    await publishRealtime({
      room: rooms.task(attachment.taskId),
      event: SOCKET_EVENTS.ATTACHMENT_CHANGED,
      data: { boardId: attachment.boardId, taskId: attachment.taskId, actorId: user.id },
    });
  }
}

/** Читает файл из multipart-запроса в буфер с контролем размера. */
export async function readMultipartFile(
  stream: AsyncIterable<Buffer>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new BadRequestError('Файл слишком большой');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
