import { describe, expect, it } from 'vitest';
import { compareRank, firstRank, rankAfter, rankBefore, rankBetween, rankForIndex, ranksBetween } from './index.js';

describe('дробные индексы порядка', () => {
  it('ранг между двумя соседями строго между ними', () => {
    const a = firstRank();
    const b = rankAfter(a);
    const middle = rankBetween(a, b);
    expect(compareRank(a, middle)).toBe(-1);
    expect(compareRank(middle, b)).toBe(-1);
  });

  it('вставка в начало и в конец', () => {
    const a = firstRank();
    expect(compareRank(rankBefore(a), a)).toBe(-1);
    expect(compareRank(a, rankAfter(a))).toBe(-1);
  });

  it('серия рангов монотонно возрастает', () => {
    const ranks = ranksBetween(null, null, 10);
    expect(ranks).toHaveLength(10);
    const sorted = [...ranks].sort();
    expect(ranks).toEqual(sorted);
  });

  it('многократная вставка между одними и теми же соседями не ломает порядок', () => {
    let low = firstRank();
    const high = rankAfter(low);
    for (let i = 0; i < 50; i += 1) {
      const next = rankBetween(low, high);
      expect(compareRank(low, next)).toBe(-1);
      expect(compareRank(next, high)).toBe(-1);
      low = next;
    }
  });

  it('ранг по индексу вставки', () => {
    const ranks = ranksBetween(null, null, 3);
    const first = rankForIndex(ranks, 0);
    const middle = rankForIndex(ranks, 1);
    const last = rankForIndex(ranks, 3);
    expect(compareRank(first, ranks[0] as string)).toBe(-1);
    expect(compareRank(ranks[0] as string, middle)).toBe(-1);
    expect(compareRank(ranks[2] as string, last)).toBe(-1);
  });
});
