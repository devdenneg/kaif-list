import { describe, expect, it } from 'vitest';

/**
 * Логика подбора сочетания вынесена в чистую функцию,
 * чтобы её можно было проверить без DOM.
 */
function buildCandidates(event: {
  key: string;
  code: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string[] {
  const prefix: string[] = [];
  if (event.metaKey || event.ctrlKey) prefix.push('mod');
  if (event.altKey) prefix.push('alt');

  const physical = event.code.replace(/^Key/, '').replace(/^Digit/, '').toLowerCase();

  const candidates = new Set<string>();
  for (const key of [event.key.toLowerCase(), physical]) {
    if (!key) continue;
    candidates.add([...prefix, key].join('+'));
    if (event.shiftKey) candidates.add([...prefix, 'shift', key].join('+'));
  }
  return [...candidates];
}

describe('подбор сочетания клавиш', () => {
  it('латинская раскладка: C → c', () => {
    expect(buildCandidates({ key: 'c', code: 'KeyC' })).toContain('c');
  });

  it('русская раскладка: та же клавиша даёт «с», но код прежний', () => {
    // Без учёта event.code сочетание `c` не сработало бы у половины команды.
    expect(buildCandidates({ key: 'с', code: 'KeyC' })).toContain('c');
  });

  it('Cmd+K распознаётся и на русской раскладке', () => {
    expect(buildCandidates({ key: 'л', code: 'KeyK', metaKey: true })).toContain('mod+k');
  });

  it('«?» набирается через Shift — учитываем оба варианта', () => {
    const candidates = buildCandidates({ key: '?', code: 'Digit7', shiftKey: true });
    expect(candidates).toContain('?');
    expect(candidates).toContain('shift+?');
  });

  it('Ctrl+Enter не путается с обычным Enter', () => {
    expect(buildCandidates({ key: 'Enter', code: 'Enter', ctrlKey: true })).toContain('mod+enter');
    expect(buildCandidates({ key: 'Enter', code: 'Enter' })).not.toContain('mod+enter');
  });
});
