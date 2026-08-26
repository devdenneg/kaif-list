/**
 * Недавно открытое — для командной палитры.
 *
 * Работа в трекере кругами ходит вокруг двух-трёх задач и одной доски.
 * Заставлять каждый раз набирать запрос ради того, к чему только что
 * возвращались, — терять секунды на пустом месте.
 *
 * Живёт в браузере: это личная история, серверу она не нужна.
 */

export interface RecentItem {
  type: 'task' | 'board';
  /** Ключ задачи (KAIF-7) или ключ доски — по нему строится адрес. */
  key: string;
  title: string;
  /** Цвет доски, чтобы строка выглядела как в сайдбаре. */
  color?: string;
  at: number;
}

const STORAGE_KEY = 'kaif:recent';
/** Больше семи строк превращают список в ещё один поиск. */
const LIMIT = 7;

export function readRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).sort((a, b) => b.at - a.at).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecent(item: Omit<RecentItem, 'at'>): void {
  if (!item.key || !item.title) return;
  try {
    const id = `${item.type}:${item.key}`;
    const next = [
      { ...item, at: Date.now() },
      // Повтор не плодим: у элемента одно место в списке — самое свежее.
      ...readRecent().filter((existing) => `${existing.type}:${existing.key}` !== id),
    ].slice(0, LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Приватный режим — обойдёмся без истории.
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // см. выше
  }
}

function isRecent(value: unknown): value is RecentItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentItem>;
  return (
    (item.type === 'task' || item.type === 'board') &&
    typeof item.key === 'string' &&
    typeof item.title === 'string' &&
    typeof item.at === 'number'
  );
}
