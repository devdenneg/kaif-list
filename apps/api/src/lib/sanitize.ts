import { extractPlainText, type RichTextDoc, type RichTextNode } from '@kaif/shared';
import { BadRequestError } from './errors.js';

/**
 * Нормализация документа TipTap, пришедшего от клиента.
 *
 * Никогда не доверяем структуре с фронта: разрешаем строго заданный набор
 * узлов, марок и атрибутов, ограничиваем глубину и размер. Всё остальное
 * молча выбрасывается. Это защита и от XSS, и от «бомб» вроде документа
 * с миллионом вложенных списков.
 */

const MAX_DEPTH = 12;
const MAX_NODES = 4000;
const MAX_TEXT_LENGTH = 50_000;

/** Управляющие символы, которые не должны попадать в текст. */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'mention',
]);

const ALLOWED_MARKS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'highlight',
  'textStyle',
]);

/** Палитра цветов текста — произвольные значения не принимаем. */
const ALLOWED_COLORS = new Set([
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
]);

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function safeUrl(value: unknown, allowRelative = false): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  if (allowRelative && trimmed.startsWith('/')) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeMarks(marks: unknown): RichTextNode['marks'] {
  if (!Array.isArray(marks)) return undefined;
  const result: NonNullable<RichTextNode['marks']> = [];

  for (const mark of marks.slice(0, 10)) {
    if (!mark || typeof mark !== 'object') continue;
    const type = (mark as { type?: unknown }).type;
    if (typeof type !== 'string' || !ALLOWED_MARKS.has(type)) continue;
    const attrs = (mark as { attrs?: Record<string, unknown> }).attrs ?? {};

    if (type === 'link') {
      const href = safeUrl(attrs.href);
      if (!href) continue;
      result.push({ type, attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
      continue;
    }

    if (type === 'textStyle') {
      const color = typeof attrs.color === 'string' ? attrs.color.toLowerCase() : null;
      if (color && ALLOWED_COLORS.has(color)) result.push({ type, attrs: { color } });
      continue;
    }

    if (type === 'highlight') {
      const color = typeof attrs.color === 'string' ? attrs.color.toLowerCase() : null;
      result.push({ type, attrs: color && ALLOWED_COLORS.has(color) ? { color } : {} });
      continue;
    }

    result.push({ type });
  }

  return result.length > 0 ? result : undefined;
}

function sanitizeAttrs(type: string, attrs: unknown): Record<string, unknown> | undefined {
  const input = (attrs && typeof attrs === 'object' ? attrs : {}) as Record<string, unknown>;

  switch (type) {
    case 'heading': {
      const level = Number(input.level);
      return { level: level >= 1 && level <= 3 ? Math.trunc(level) : 2 };
    }
    case 'codeBlock': {
      const language = typeof input.language === 'string' ? input.language.slice(0, 24) : null;
      return { language: language && /^[a-z0-9+#-]*$/i.test(language) ? language : null };
    }
    case 'orderedList': {
      const start = Number(input.start);
      return { start: Number.isFinite(start) && start > 0 ? Math.min(Math.trunc(start), 9999) : 1 };
    }
    case 'taskItem': {
      return { checked: input.checked === true };
    }
    case 'image': {
      // Разрешаем только наши собственные вложения и абсолютные https-ссылки.
      const src = safeUrl(input.src, true);
      if (!src) return undefined;
      const alt = typeof input.alt === 'string' ? input.alt.slice(0, 200) : null;
      const title = typeof input.title === 'string' ? input.title.slice(0, 200) : null;
      return { src, alt, title };
    }
    case 'mention': {
      const id = typeof input.id === 'string' ? input.id.slice(0, 40) : null;
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
      const label = typeof input.label === 'string' ? input.label.slice(0, 64) : null;
      return { id, label };
    }
    default:
      return undefined;
  }
}

interface SanitizeState {
  nodes: number;
  textLength: number;
}

function sanitizeNode(node: unknown, depth: number, state: SanitizeState): RichTextNode | null {
  if (!node || typeof node !== 'object') return null;
  if (depth > MAX_DEPTH) return null;
  if (state.nodes >= MAX_NODES) return null;

  const input = node as RichTextNode;
  const type = input.type;
  if (typeof type !== 'string' || !ALLOWED_NODES.has(type)) return null;

  state.nodes += 1;

  if (type === 'text') {
    const text = typeof input.text === 'string' ? input.text : '';
    if (text.length === 0) return null;
    const remaining = MAX_TEXT_LENGTH - state.textLength;
    if (remaining <= 0) return null;
    const clipped = text.slice(0, remaining).replace(CONTROL_CHARS, '');
    if (clipped.length === 0) return null;
    state.textLength += clipped.length;
    const marks = sanitizeMarks(input.marks);
    return marks ? { type: 'text', text: clipped, marks } : { type: 'text', text: clipped };
  }

  const attrs = sanitizeAttrs(type, input.attrs);
  // Узлы, у которых обязательны атрибуты (image, mention), без них бессмысленны.
  if ((type === 'image' || type === 'mention') && !attrs) return null;

  const result: RichTextNode = { type };
  if (attrs) result.attrs = attrs;

  if (Array.isArray(input.content)) {
    const content: RichTextNode[] = [];
    for (const child of input.content) {
      const sanitized = sanitizeNode(child, depth + 1, state);
      if (sanitized) content.push(sanitized);
      if (state.nodes >= MAX_NODES) break;
    }
    if (content.length > 0) result.content = content;
  }

  const marks = sanitizeMarks(input.marks);
  if (marks) result.marks = marks;

  return result;
}

export interface SanitizedDoc {
  doc: RichTextDoc | null;
  text: string;
}

/**
 * Приводит присланный документ к безопасному виду и сразу отдаёт плоский текст
 * (он нужен для поиска, превью и уведомлений).
 */
export function sanitizeRichText(
  input: unknown,
  options: { required?: boolean } = {},
): SanitizedDoc {
  if (input === null || input === undefined) {
    if (options.required) throw new BadRequestError('Пустой текст');
    return { doc: null, text: '' };
  }

  const state: SanitizeState = { nodes: 0, textLength: 0 };
  const sanitized = sanitizeNode(input, 0, state);

  if (!sanitized || sanitized.type !== 'doc') {
    if (options.required) throw new BadRequestError('Некорректный формат текста');
    return { doc: null, text: '' };
  }

  const doc: RichTextDoc = {
    type: 'doc',
    content:
      sanitized.content && sanitized.content.length > 0
        ? sanitized.content
        : [{ type: 'paragraph' }],
  };

  const text = extractPlainText(doc);

  if (options.required && text.trim().length === 0 && !hasMedia(doc)) {
    throw new BadRequestError('Текст не может быть пустым');
  }

  return { doc, text };
}

function hasMedia(node: RichTextNode): boolean {
  if (node.type === 'image' || node.type === 'mention' || node.type === 'taskItem') return true;
  return Array.isArray(node.content) ? node.content.some(hasMedia) : false;
}

/** Обычный текст: убираем управляющие символы и схлопываем пробелы. */
export function sanitizePlainText(value: string, maxLength = 500): string {
  return value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
