/**
 * Сборка CSV.
 *
 * Две детали, из-за которых обычно всё ломается:
 *  1. Excel на Windows не понимает UTF-8 без BOM — кириллица превращается
 *     в мусор. Поэтому BOM добавляется всегда.
 *  2. Excel «умно» разбирает значения, начинающиеся с `=`, `+`, `-`, `@`,
 *     и выполняет их как формулы. Такие значения экранируются апострофом —
 *     иначе выгрузка становится вектором атаки на того, кто её открыл.
 */

const BOM = '﻿';
const DELIMITER = ';';
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;

  if (text.includes('"') || text.includes(DELIMITER) || /[\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(DELIMITER)];
  for (const row of rows) lines.push(row.map(escapeCell).join(DELIMITER));
  // CRLF — так файл корректно открывается и в Excel, и в LibreOffice.
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Безопасное имя файла для заголовка Content-Disposition. */
export function csvFilename(base: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safe = base.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  return `${safe}-${date}.csv`;
}
