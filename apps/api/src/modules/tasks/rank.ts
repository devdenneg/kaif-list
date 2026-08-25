import type { ColumnKey } from '@kaif/shared';
import { rankAfter, rankBetween } from '@kaif/shared';
import type { Prisma } from '@prisma/client';

/**
 * Вычисление дробного ранга для позиции вставки.
 *
 * Клиент присылает соседей («поставить перед задачей X» / «после задачи Y»),
 * а сервер считает ранг между ними. Так перенос карточки — это один UPDATE
 * одной строки, и два человека могут таскать карточки одновременно
 * без переиндексации всей колонки.
 */

export interface RankPositionInput {
  boardId: string;
  columnKey: ColumnKey;
  isBacklog: boolean;
  /** Вставить ПЕРЕД этой задачей (новая окажется выше). */
  beforeTaskId?: string | null;
  /** Вставить ПОСЛЕ этой задачи (новая окажется ниже). */
  afterTaskId?: string | null;
  /** Перемещаемая задача исключается из расчёта соседей. */
  excludeTaskId?: string | null;
}

export async function computeRank(
  tx: Prisma.TransactionClient,
  input: RankPositionInput,
): Promise<string> {
  const scope = {
    boardId: input.boardId,
    columnKey: input.columnKey,
    isBacklog: input.isBacklog,
    archivedAt: null,
    ...(input.excludeTaskId ? { id: { not: input.excludeTaskId } } : {}),
  } satisfies Prisma.TaskWhereInput;

  let lower: string | null = null;
  let upper: string | null = null;

  if (input.afterTaskId) {
    const after = await tx.task.findFirst({
      where: { id: input.afterTaskId, boardId: input.boardId },
      select: { rank: true },
    });
    lower = after?.rank ?? null;
  }

  if (input.beforeTaskId) {
    const before = await tx.task.findFirst({
      where: { id: input.beforeTaskId, boardId: input.boardId },
      select: { rank: true },
    });
    upper = before?.rank ?? null;
  }

  if (lower && !upper) {
    const next = await tx.task.findFirst({
      where: { ...scope, rank: { gt: lower } },
      orderBy: { rank: 'asc' },
      select: { rank: true },
    });
    upper = next?.rank ?? null;
  }

  if (upper && !lower) {
    const previous = await tx.task.findFirst({
      where: { ...scope, rank: { lt: upper } },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    lower = previous?.rank ?? null;
  }

  if (!lower && !upper) {
    const last = await tx.task.findFirst({
      where: scope,
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    return rankAfter(last?.rank ?? null);
  }

  try {
    return rankBetween(lower, upper);
  } catch {
    // Соседи пришли в некорректном порядке (гонка на клиенте) — ставим в конец.
    const last = await tx.task.findFirst({
      where: scope,
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    return rankAfter(last?.rank ?? null);
  }
}
