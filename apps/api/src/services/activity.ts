import type { ActivityType } from '@kaif/shared';
import type { Prisma } from '@prisma/client';

/**
 * Лента активности = аудит.
 * Пишем всё: кто, что, когда и с какими значениями до/после.
 */

export interface ActivityInput {
  boardId: string;
  taskId?: string | null;
  actorId: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
}

export async function recordActivity(
  tx: Prisma.TransactionClient,
  input: ActivityInput,
): Promise<void> {
  await tx.activity.create({
    data: {
      boardId: input.boardId,
      taskId: input.taskId ?? null,
      actorId: input.actorId,
      type: input.type,
      payload: (input.payload ?? {}) as object,
    },
  });
}
