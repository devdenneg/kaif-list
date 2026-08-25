import { describe, expect, it } from 'vitest';
import { columnLabel, escapeHtml, formatTaskList, type TaskLine } from './text.js';

const APP_URL = 'https://board.example.com';

const task = (overrides: Partial<TaskLine> = {}): TaskLine => ({
  key: 'OPS-12',
  title: 'Поправить экспорт',
  columnKey: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: null,
  boardName: 'Операции',
  ...overrides,
});

describe('экранирование HTML', () => {
  it('спецсимволы не ломают разметку Telegram', () => {
    expect(escapeHtml('<b>жирный</b> & <i>')).toBe('&lt;b&gt;жирный&lt;/b&gt; &amp; &lt;i&gt;');
  });

  it('заголовок задачи с тегами безопасен', () => {
    const output = formatTaskList([task({ title: '<script>alert(1)</script>' })], APP_URL, 'нет');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });
});

describe('список задач', () => {
  it('пустой список отдаёт заглушку', () => {
    expect(formatTaskList([], APP_URL, 'Задач нет')).toBe('Задач нет');
  });

  it('содержит ключ, название и ссылку', () => {
    const output = formatTaskList([task()], APP_URL, 'нет');
    expect(output).toContain('OPS-12');
    expect(output).toContain('Поправить экспорт');
    expect(output).toContain(`${APP_URL}/tasks/OPS-12`);
    expect(output).toContain('Операции');
  });

  it('просроченная задача помечается', () => {
    const output = formatTaskList(
      [task({ dueDate: new Date(Date.now() - 86_400_000).toISOString() })],
      APP_URL,
      'нет',
    );
    expect(output).toContain('🔴');
    expect(output).toContain('просрочено');
  });

  it('несколько задач разделяются пустой строкой', () => {
    const output = formatTaskList([task(), task({ key: 'OPS-13' })], APP_URL, 'нет');
    expect(output.split('\n\n')).toHaveLength(2);
  });
});

describe('названия колонок', () => {
  it('переводит известные ключи', () => {
    expect(columnLabel('IN_PROGRESS')).toBe('В работе');
    expect(columnLabel('ON_HOLD')).toBe('На паузе');
  });

  it('неизвестный ключ возвращается как есть', () => {
    expect(columnLabel('НЕЧТО')).toBe('НЕЧТО');
  });
});
