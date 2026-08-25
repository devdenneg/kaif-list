import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, NO_COLLAPSED_COLUMNS, hasActiveFilters } from './ui';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectSources(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, files);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

describe('селекторы стора', () => {
  /**
   * Реальная ошибка, стоившая падения всей доски: селектор возвращал
   * `state.collapsedColumns[id] ?? []`. Литерал `[]` создаётся заново при
   * каждом вызове, а Zustand работает через `useSyncExternalStore`, который
   * считает новую ссылку изменением состояния. Итог — бесконечная
   * перерисовка и «Minified React error #185» вместо интерфейса.
   *
   * Тест сканирует исходники, потому что поймать это типами невозможно,
   * а цена ошибки — полностью неработающая страница.
   */
  it('не возвращают свежий литерал в качестве значения по умолчанию', () => {
    const offenders: string[] = [];
    const selectorWithLiteral = /use\w*Store\(\s*\([^)]*\)\s*=>[^)]*\?\?\s*(\[\]|\{\})/;

    for (const file of collectSources(srcDir)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const [index, line] of content.split('\n').entries()) {
        if (selectorWithLiteral.test(line)) {
          offenders.push(`${path.relative(srcDir, file)}:${index + 1}`);
        }
      }
    }

    expect(
      offenders,
      'Фолбэк нужно выносить за пределы селектора и использовать константу модуля',
    ).toEqual([]);
  });

  it('константы по умолчанию стабильны между обращениями', () => {
    expect(NO_COLLAPSED_COLUMNS).toBe(NO_COLLAPSED_COLUMNS);
    expect(EMPTY_FILTERS).toBe(EMPTY_FILTERS);
    expect(NO_COLLAPSED_COLUMNS).toHaveLength(0);
  });
});

describe('активность фильтров', () => {
  it('пустой набор не считается активным', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('любой заполненный признак делает набор активным', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: 'ошибка' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, assigneeIds: ['u1'] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, due: 'overdue' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, unassigned: true })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, includeArchived: true })).toBe(true);
  });

  it('пробелы в поиске не считаются фильтром', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: '   ' })).toBe(false);
  });
});
