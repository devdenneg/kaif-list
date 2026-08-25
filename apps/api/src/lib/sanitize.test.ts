import { describe, expect, it } from 'vitest';
import { sanitizePlainText, sanitizeRichText } from './sanitize.js';

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('санитайзер форматированного текста', () => {
  it('пропускает разрешённые узлы', () => {
    const { doc, text } = sanitizeRichText({
      type: 'doc',
      content: [
        paragraph('Привет'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Пункт')] }] },
      ],
    });
    expect(doc?.content).toHaveLength(2);
    expect(text).toContain('Привет');
    expect(text).toContain('Пункт');
  });

  it('вырезает неизвестные узлы', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [{ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }, paragraph('Ок')],
    });
    const types = (doc?.content ?? []).map((node) => node.type);
    expect(types).not.toContain('script');
    expect(types).toContain('paragraph');
  });

  it('убирает javascript-ссылки', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'клик',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });
    const marks = (doc?.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type);
    expect(marks).not.toContain('link');
  });

  it('нормализует безопасные ссылки', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'ссылка',
              marks: [{ type: 'link', attrs: { href: 'https://example.com', onclick: 'x()' } }],
            },
          ],
        },
      ],
    });
    const mark = doc?.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.type).toBe('link');
    expect(mark?.attrs?.rel).toBe('noopener noreferrer nofollow');
    expect(mark?.attrs?.onclick).toBeUndefined();
  });

  it('картинки только со своего пути или https', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'javascript:alert(1)' } },
        { type: 'image', attrs: { src: '/api/attachments/abc123' } },
      ],
    });
    const images = (doc?.content ?? []).filter((node) => node.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs?.src).toBe('/api/attachments/abc123');
  });

  it('упоминание без id выбрасывается', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { label: 'Кто-то' } },
            { type: 'mention', attrs: { id: 'user-1', label: 'Ирина' } },
          ],
        },
      ],
    });
    const mentions = (doc?.content?.[0]?.content ?? []).filter((node) => node.type === 'mention');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.attrs?.id).toBe('user-1');
  });

  it('ограничивает глубину вложенности', () => {
    let node: Record<string, unknown> = paragraph('дно');
    for (let i = 0; i < 40; i += 1) {
      node = { type: 'blockquote', content: [node] };
    }
    const { doc } = sanitizeRichText({ type: 'doc', content: [node] });
    // Документ остаётся валидным и не роняет сервер.
    expect(doc?.type).toBe('doc');
  });

  it('произвольный цвет текста не принимается', () => {
    const { doc } = sanitizeRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'цвет',
              marks: [{ type: 'textStyle', attrs: { color: 'url(javascript:1)' } }],
            },
          ],
        },
      ],
    });
    expect(doc?.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it('пустой документ при required бросает ошибку', () => {
    expect(() => sanitizeRichText({ type: 'doc', content: [] }, { required: true })).toThrow();
    expect(() => sanitizeRichText(null, { required: true })).toThrow();
  });

  it('не-документ отбрасывается', () => {
    const { doc } = sanitizeRichText({ type: 'paragraph' });
    expect(doc).toBeNull();
  });
});

describe('санитайзер обычного текста', () => {
  it('схлопывает пробелы и режет длину', () => {
    expect(sanitizePlainText('  много   пробелов  ')).toBe('много пробелов');
    expect(sanitizePlainText('a'.repeat(100), 10)).toHaveLength(10);
  });

  it('удаляет управляющие символы', () => {
    const withNull = `текст${String.fromCharCode(0)}тут`;
    expect(sanitizePlainText(withNull)).toBe('тексттут');
  });
});
