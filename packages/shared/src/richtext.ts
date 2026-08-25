import { taskKeyScanner } from './constants.js';

/**
 * Работа с документом TipTap/ProseMirror.
 * Один и тот же код нужен на сервере (индексация текста, разбор упоминаний,
 * уведомления) и на клиенте (предпросмотр, счётчики) — поэтому он в shared.
 */

export interface RichTextNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: RichTextNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  /**
   * ProseMirror и расширения TipTap могут добавлять собственные поля.
   * Мы их не используем, но и не обязаны знать заранее: санитайзер на сервере
   * всё равно оставит только разрешённое.
   */
  [key: string]: unknown;
}

export interface RichTextDoc extends RichTextNode {
  type: 'doc';
  content?: RichTextNode[];
}

export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Блочные узлы, между которыми при извлечении текста ставится перевод строки. */
const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'horizontalRule',
  'tableRow',
]);

/** Плоский текст документа — для поиска, превью и уведомлений. */
export function extractPlainText(doc: unknown, maxLength = 50_000): string {
  const out: string[] = [];

  const walk = (node: RichTextNode | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') {
      out.push(node.text);
      return;
    }
    if (node.type === 'mention') {
      const label = (node.attrs?.label ?? node.attrs?.id ?? '') as string;
      if (label) out.push(`@${label}`);
      return;
    }
    if (node.type === 'hardBreak') {
      out.push('\n');
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
    if (node.type && BLOCK_NODES.has(node.type)) out.push('\n');
  };

  walk(doc as RichTextNode);
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** id пользователей, упомянутых через `@` в документе. */
export function extractMentionIds(doc: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: RichTextNode | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'mention') {
      const id = node.attrs?.id;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  };
  walk(doc as RichTextNode);
  return [...ids];
}

/** Ключи задач (`OPS-12`), упомянутые в тексте. */
export function extractTaskKeys(text: string): string[] {
  const matches = text.match(taskKeyScanner());
  return matches ? [...new Set(matches)] : [];
}

/** Документ пустой (нет ни текста, ни картинок, ни упоминаний)? */
export function isEmptyDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return true;
  const hasMedia = containsNodeOfType(doc as RichTextNode, ['image', 'mention', 'taskItem']);
  if (hasMedia) return false;
  return extractPlainText(doc).length === 0;
}

function containsNodeOfType(node: RichTextNode | undefined, types: string[]): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type && types.includes(node.type)) return true;
  if (Array.isArray(node.content)) {
    return node.content.some((child) => containsNodeOfType(child, types));
  }
  return false;
}

/** Короткое превью для списков и уведомлений. */
export function toPreview(doc: unknown, maxLength = 160): string {
  const text = extractPlainText(doc).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Простой документ из строки — для системных комментариев. */
export function docFromText(text: string): RichTextDoc {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((p) => ({
            type: 'paragraph',
            content: p
              .split('\n')
              .flatMap((line, index) =>
                index === 0
                  ? [{ type: 'text', text: line }]
                  : [{ type: 'hardBreak' }, { type: 'text', text: line }],
              )
              .filter((n) => n.type !== 'text' || (n.text ?? '').length > 0),
          }))
        : [{ type: 'paragraph' }],
  };
}
