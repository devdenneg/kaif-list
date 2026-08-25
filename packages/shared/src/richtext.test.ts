import { describe, expect, it } from 'vitest';
import { docFromText, extractMentionIds, extractPlainText, extractTaskKeys, isEmptyDoc, toPreview } from './index.js';

describe('работа с документом', () => {
  const doc = {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Привет, ' },
          { type: 'mention', attrs: { id: 'user-1', label: 'Ирина' } },
          { type: 'text', text: '! Смотри OPS-12 и DEV-3.' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Вторая строка' }] },
    ],
  };

  it('извлекает плоский текст', () => {
    const text = extractPlainText(doc);
    expect(text).toContain('Привет');
    expect(text).toContain('@Ирина');
    expect(text).toContain('Вторая строка');
  });

  it('находит упоминания', () => {
    expect(extractMentionIds(doc)).toEqual(['user-1']);
  });

  it('находит ключи задач в тексте', () => {
    expect(extractTaskKeys(extractPlainText(doc))).toEqual(['OPS-12', 'DEV-3']);
  });

  it('строит превью', () => {
    expect(toPreview(doc, 20).length).toBeLessThanOrEqual(20);
  });

  it('определяет пустой документ', () => {
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isEmptyDoc(doc)).toBe(false);
    expect(isEmptyDoc(null)).toBe(true);
  });

  it('создаёт документ из текста с переносами', () => {
    const built = docFromText('Первый абзац\n\nВторой абзац');
    expect(built.content).toHaveLength(2);
    expect(extractPlainText(built)).toContain('Второй абзац');
  });
});
