import { describe, expect, it } from 'vitest';
import { buildCsv, csvFilename } from './csv.js';

describe('сборка CSV', () => {
  it('добавляет BOM — иначе Excel ломает кириллицу', () => {
    const csv = buildCsv(['Заголовок'], [['Задача']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('экранирует разделитель и кавычки', () => {
    const csv = buildCsv(['a', 'b'], [['текст;с разделителем', 'кавычка "внутри"']]);
    expect(csv).toContain('"текст;с разделителем"');
    expect(csv).toContain('"кавычка ""внутри"""');
  });

  it('переносы строк не разрывают запись', () => {
    const csv = buildCsv(['a'], [['первая\nвторая']]);
    expect(csv).toContain('"первая\nвторая"');
    // Строки записи разделяются CRLF, перенос внутри значения — обычным LF.
    expect(csv.split('\r\n').length).toBe(3);
  });

  it('обезвреживает формулы — выгрузку открывают в Excel', () => {
    const csv = buildCsv(['a'], [['=1+1'], ['+SUM(A1)'], ['-2'], ['@cmd']]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+SUM(A1)");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@cmd");
  });

  it('пустые значения не превращаются в undefined', () => {
    const csv = buildCsv(['a', 'b'], [[null, undefined]]);
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
  });

  it('имя файла безопасно и содержит дату', () => {
    const name = csvFilename('OPS/../etc');
    expect(name).toMatch(/^OPS-etc-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
