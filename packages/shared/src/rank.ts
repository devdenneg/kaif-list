import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Порядок карточек внутри колонки хранится строковым «дробным индексом».
 * Перенос карточки = обновление ОДНОЙ строки, без переиндексации всей колонки.
 * Это критично для реалтайма: два человека могут двигать карточки одновременно.
 */
export type Rank = string;

/** Ранг между двумя соседями. `null` — край списка. */
export function rankBetween(before: Rank | null, after: Rank | null): Rank {
  return generateKeyBetween(before ?? null, after ?? null);
}

/** N рангов подряд между двумя соседями (массовые операции, импорт). */
export function ranksBetween(before: Rank | null, after: Rank | null, count: number): Rank[] {
  if (count <= 0) return [];
  return generateNKeysBetween(before ?? null, after ?? null, count);
}

/** Первый ранг в пустой колонке. */
export function firstRank(): Rank {
  return generateKeyBetween(null, null);
}

/** Ранг для добавления в конец списка. */
export function rankAfter(last: Rank | null): Rank {
  return generateKeyBetween(last ?? null, null);
}

/** Ранг для добавления в начало списка. */
export function rankBefore(first: Rank | null): Rank {
  return generateKeyBetween(null, first ?? null);
}

export function compareRank(a: Rank, b: Rank): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Вычисляет новый ранг по позиции вставки в уже отсортированном списке рангов.
 * `index` — итоговая позиция карточки в списке БЕЗ учёта самой перемещаемой карточки.
 */
export function rankForIndex(sortedRanks: Rank[], index: number): Rank {
  const clamped = Math.max(0, Math.min(index, sortedRanks.length));
  const before = clamped > 0 ? (sortedRanks[clamped - 1] ?? null) : null;
  const after = clamped < sortedRanks.length ? (sortedRanks[clamped] ?? null) : null;
  return rankBetween(before, after);
}
