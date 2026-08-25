import { BOARD_KEY_REGEX } from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';

/** Транслитерация кириллицы — ключ доски всегда латиницей. */
const TRANSLIT: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z',
  и: 'I', й: 'I', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R',
  с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'C', ч: 'CH', ш: 'SH', щ: 'SCH',
  ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU', я: 'YA',
};

function transliterate(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .toUpperCase();
}

/**
 * Ключ доски из её названия: «Операции DevOps» → OPD.
 * Берём первые буквы слов, если слово одно — первые буквы слова.
 */
export function suggestBoardKey(name: string): string {
  const latin = transliterate(name).replace(/[^A-Z0-9\s]/g, ' ');
  const words = latin.split(/\s+/).filter(Boolean);

  let candidate = '';
  if (words.length >= 2) {
    candidate = words
      .slice(0, 4)
      .map((word) => word[0] ?? '')
      .join('');
  } else {
    candidate = (words[0] ?? '').slice(0, 4);
  }

  candidate = candidate.replace(/[^A-Z0-9]/g, '');
  if (candidate.length < 2) candidate = `${candidate}BOARD`.slice(0, 4);
  if (/^[0-9]/.test(candidate)) candidate = `B${candidate}`;
  return candidate.slice(0, 6);
}

/** Гарантирует уникальность ключа, добавляя номер при коллизии. */
export async function ensureUniqueBoardKey(preferred: string): Promise<string> {
  const base = preferred.slice(0, 6).toUpperCase();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    if (!BOARD_KEY_REGEX.test(candidate)) continue;
    const existing = await prisma.board.findUnique({
      where: { key: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Практически недостижимо, но лучше вернуть валидный ключ, чем упасть.
  return `B${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
