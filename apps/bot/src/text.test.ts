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

describe('экраны бота', () => {
  it('данные кнопок влезают в ограничение Telegram', async () => {
    const { taskScreen, statsScreen, boardsScreen } = await import('./screens.js');

    // cuid — 25 символов; проверяем на самом длинном разумном идентификаторе.
    const id = 'cmt8x6wwr0016mt1wyloyumcw';
    const screens = [
      taskScreen(
        {
          id,
          key: 'KAIF-777',
          title: 'Заголовок',
          columnKey: 'QA',
          priority: 'HIGH',
          dueDate: null,
          boardName: 'Доска',
          assigneeName: null,
          testerName: null,
          commentCount: 0,
          blockedByCount: 0,
          isMine: false,
        },
        'https://example.test',
        'm:t:act',
      ),
      boardsScreen([{ id, key: 'KAIF', name: 'Доска', role: 'OWNER', myTasks: 3 }], 'stats'),
    ];

    for (const screen of screens) {
      for (const row of screen.keyboard.inline_keyboard) {
        for (const button of row) {
          if ('callback_data' in button && button.callback_data) {
            // Telegram обрезает всё, что длиннее 64 байт, и кнопка ломается.
            expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
          }
        }
      }
    }

    expect(statsScreen).toBeTypeOf('function');
  });

  it('карточка задачи предлагает только соседние колонки', async () => {
    const { taskScreen } = await import('./screens.js');
    const screen = taskScreen(
      {
        id: 'task-1',
        key: 'KAIF-1',
        title: 'Заголовок',
        columnKey: 'QA',
        priority: 'MEDIUM',
        dueDate: null,
        boardName: 'Доска',
        assigneeName: null,
        testerName: null,
        commentCount: 0,
        blockedByCount: 0,
        isMine: false,
      },
      'https://example.test',
      'm:t:act',
    );

    const moves = screen.keyboard.inline_keyboard
      .flat()
      .filter((button) => 'callback_data' in button && button.callback_data?.startsWith('mv:'))
      .map((button) => ('callback_data' in button ? button.callback_data : ''));

    // Из «Тестирования» — шаг назад в работу и шаг вперёд к релизу.
    expect(moves).toEqual(['mv:task-1:IN_PROGRESS', 'mv:task-1:READY_TO_RELEASE']);
  });

  it('не своя задача предлагает взять её себе, своя — нет', async () => {
    const { taskScreen } = await import('./screens.js');
    const base = {
      id: 'task-1',
      key: 'KAIF-1',
      title: 'Заголовок',
      columnKey: 'TODO',
      priority: 'MEDIUM',
      dueDate: null,
      boardName: 'Доска',
      assigneeName: null,
      testerName: null,
      commentCount: 0,
      blockedByCount: 0,
    };

    const foreign = taskScreen({ ...base, isMine: false }, 'https://example.test', 'm:home');
    const mine = taskScreen({ ...base, isMine: true }, 'https://example.test', 'm:home');

    const hasAssign = (screen: { keyboard: { inline_keyboard: unknown[][] } }): boolean =>
      JSON.stringify(screen.keyboard.inline_keyboard).includes('as:task-1');

    expect(hasAssign(foreign)).toBe(true);
    expect(hasAssign(mine)).toBe(false);
  });
});
