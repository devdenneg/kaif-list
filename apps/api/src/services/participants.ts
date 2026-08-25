import { ParticipantRole } from '@kaif/shared';
import type { Prisma } from '@prisma/client';

/**
 * Участники задачи.
 *
 * Ключевое правило продукта: любой, кто как-то поучаствовал в задаче
 * (написал комментарий, приложил файл, изменил поля), автоматически становится
 * контрибьютором и дальше получает уведомления. Отписаться можно вручную.
 */

type Tx = Prisma.TransactionClient;

export async function addParticipant(
  tx: Tx,
  taskId: string,
  userId: string | null | undefined,
  role: ParticipantRole,
): Promise<void> {
  if (!userId) return;
  await tx.taskParticipant.upsert({
    where: { taskId_userId_role: { taskId, userId, role } },
    create: { taskId, userId, role },
    update: {},
  });
}

export async function removeParticipantRole(
  tx: Tx,
  taskId: string,
  userId: string | null | undefined,
  role: ParticipantRole,
): Promise<void> {
  if (!userId) return;
  await tx.taskParticipant.deleteMany({ where: { taskId, userId, role } });
}

/**
 * Добавляет пользователя контрибьютором, если он ещё никак не связан с задачей.
 * Если он уже автор/исполнитель/тестировщик — ничего не делаем, роль не понижаем.
 */
export async function ensureContributor(
  tx: Tx,
  taskId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const existing = await tx.taskParticipant.findFirst({
    where: { taskId, userId },
    select: { id: true },
  });
  if (existing) return;
  await tx.taskParticipant.create({
    data: { taskId, userId, role: ParticipantRole.CONTRIBUTOR },
  });
}

/** Синхронизирует «служебные» роли после изменения полей задачи. */
export async function syncCoreParticipants(
  tx: Tx,
  taskId: string,
  next: { reporterId: string; assigneeId?: string | null; testerId?: string | null },
  previous?: { assigneeId?: string | null; testerId?: string | null },
): Promise<void> {
  await addParticipant(tx, taskId, next.reporterId, ParticipantRole.REPORTER);

  if (previous && previous.assigneeId && previous.assigneeId !== next.assigneeId) {
    await removeParticipantRole(tx, taskId, previous.assigneeId, ParticipantRole.ASSIGNEE);
    // Бывший исполнитель остаётся в курсе как контрибьютор.
    await ensureContributor(tx, taskId, previous.assigneeId);
  }
  if (previous && previous.testerId && previous.testerId !== next.testerId) {
    await removeParticipantRole(tx, taskId, previous.testerId, ParticipantRole.TESTER);
    await ensureContributor(tx, taskId, previous.testerId);
  }

  await addParticipant(tx, taskId, next.assigneeId ?? null, ParticipantRole.ASSIGNEE);
  await addParticipant(tx, taskId, next.testerId ?? null, ParticipantRole.TESTER);
}

/** Явная подписка/отписка от задачи. */
export async function setWatching(
  tx: Tx,
  taskId: string,
  userId: string,
  watch: boolean,
): Promise<void> {
  if (watch) {
    await tx.taskParticipant.upsert({
      where: { taskId_userId_role: { taskId, userId, role: ParticipantRole.WATCHER } },
      create: { taskId, userId, role: ParticipantRole.WATCHER },
      update: { muted: false },
    });
    await tx.taskParticipant.updateMany({ where: { taskId, userId }, data: { muted: false } });
  } else {
    // Не удаляем роли (автор/исполнитель остаются), а глушим уведомления.
    await tx.taskParticipant.updateMany({ where: { taskId, userId }, data: { muted: true } });
    await tx.taskParticipant.deleteMany({
      where: { taskId, userId, role: ParticipantRole.WATCHER },
    });
  }
}
