import { InlineKeyboard } from 'grammy';
import { COLUMN_ORDER, PRIORITY_LABELS, formatDueRelative } from '@kaif/shared';
import { columnLabel, escapeHtml, type TaskLine } from './text.js';

/**
 * Экраны бота.
 *
 * Бот работает как приложение: одно сообщение, которое перерисовывается
 * кнопками, а не лента из десятка ответов. Поэтому каждый экран — это
 * пара «текст + клавиатура», а обработчик просто заменяет содержимое
 * того же сообщения.
 *
 * Данные для кнопок ограничены 64 байтами, поэтому коды короткие:
 * `m:` — меню, `t:` — задача, `s:` — сводка, `b:` — доска.
 */

export interface BoardLine {
  id: string;
  key: string;
  name: string;
  role: string;
  myTasks: number;
}

export interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

const SCOPE_CODES = {
  act: 'active',
  tod: 'today',
  ovd: 'overdue',
  tst: 'testing',
} as const;

export type ScopeCode = keyof typeof SCOPE_CODES;

export function scopeOf(code: string): (typeof SCOPE_CODES)[ScopeCode] | null {
  return SCOPE_CODES[code as ScopeCode] ?? null;
}

const SCOPE_TITLES: Record<ScopeCode, string> = {
  act: '📋 Мои задачи',
  tod: '📅 На сегодня',
  ovd: '🔴 Просрочено',
  tst: '🔍 На моём тестировании',
};

const SCOPE_EMPTY: Record<ScopeCode, string> = {
  act: 'Активных задач нет — чисто.',
  tod: 'На сегодня ничего не горит.',
  ovd: 'Просроченного нет. Так держать.',
  tst: 'Задач на тестировании нет.',
};

/** Главное меню. Отсюда начинается всё, что умеет бот. */
export function homeScreen(name: string, hasManagedBoards: boolean): Screen {
  const keyboard = new InlineKeyboard()
    .text('📋 Мои задачи', 'm:t:act')
    .text('📅 Сегодня', 'm:t:tod')
    .row()
    .text('🔴 Просрочено', 'm:t:ovd')
    .text('🔍 На тесте', 'm:t:tst')
    .row()
    .text('🗂 Доски', 'm:b')
    .text('➕ Новая задача', 'm:new');

  if (hasManagedBoards) keyboard.row().text('📊 Сводка по доске', 'm:st');
  keyboard.row().text('⚙️ Уведомления', 'm:s');

  return {
    text: [
      `👋 <b>${escapeHtml(name)}</b>`,
      '',
      'Что смотрим?',
      '',
      '<i>Подсказка: пришлите ключ задачи — например KAIF-7 — и я покажу её карточку.</i>',
    ].join('\n'),
    keyboard,
  };
}

/** Список задач: каждая — кнопка, чтобы открыть карточку одним касанием. */
export function taskListScreen(code: ScopeCode, tasks: TaskLine[], taskIds: string[]): Screen {
  const keyboard = new InlineKeyboard();

  tasks.slice(0, 8).forEach((task, index) => {
    const id = taskIds[index];
    if (!id) return;
    keyboard.text(`${task.key} · ${trim(task.title, 28)}`, `t:${id}`).row();
  });

  keyboard.text('‹ Меню', 'm:home').text('↻ Обновить', `m:t:${code}`);

  const body =
    tasks.length === 0
      ? SCOPE_EMPTY[code]
      : tasks
          .slice(0, 8)
          .map((task) => {
            const meta = [escapeHtml(task.boardName)];
            if (task.dueDate) {
              const overdue = new Date(task.dueDate).getTime() < Date.now();
              meta.push(`${overdue ? '🔴' : '🕒'} ${escapeHtml(formatDueRelative(task.dueDate))}`);
            }
            return [
              `<b>${escapeHtml(task.key)}</b> ${escapeHtml(task.title)}`,
              `<i>${escapeHtml(columnLabel(task.columnKey))} · ${meta.join(' · ')}</i>`,
            ].join('\n');
          })
          .join('\n\n');

  const more = tasks.length > 8 ? `\n\n<i>…и ещё ${tasks.length - 8}</i>` : '';

  return { text: `<b>${SCOPE_TITLES[code]}</b>\n\n${body}${more}`, keyboard };
}

export interface TaskCard {
  id: string;
  key: string;
  title: string;
  columnKey: string;
  priority: string;
  dueDate: string | null;
  descriptionPreview?: string | null;
  boardName: string;
  assigneeName: string | null;
  testerName: string | null;
  commentCount: number;
  blockedByCount: number;
  isMine: boolean;
}

/**
 * Карточка задачи с действиями.
 *
 * Кнопки переноса — только соседние колонки: полный список из шести штук
 * в чате читается хуже, чем одна нужная.
 */
export function taskScreen(task: TaskCard, appUrl: string, backTo: string): Screen {
  const lines = [
    `<b>${escapeHtml(task.key)}</b> ${escapeHtml(task.title)}`,
    '',
    `${escapeHtml(columnLabel(task.columnKey))} · ${escapeHtml(task.boardName)}`,
  ];

  if (task.blockedByCount > 0) {
    lines.push(`⛔ Заблокирована: ждёт ${task.blockedByCount}`);
  }
  lines.push(`Исполнитель: ${task.assigneeName ? escapeHtml(task.assigneeName) : '— не назначен'}`);
  if (task.testerName) lines.push(`Тестировщик: ${escapeHtml(task.testerName)}`);
  if (task.dueDate) {
    const overdue = new Date(task.dueDate).getTime() < Date.now();
    lines.push(`${overdue ? '🔴' : '🕒'} ${escapeHtml(formatDueRelative(task.dueDate))}`);
  }
  const priority = PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS];
  if (priority) lines.push(`Приоритет: ${escapeHtml(priority)}`);
  if (task.commentCount > 0) lines.push(`💬 Комментариев: ${task.commentCount}`);
  if (task.descriptionPreview) {
    lines.push('', `<i>${escapeHtml(trim(task.descriptionPreview, 220))}</i>`);
  }

  const keyboard = new InlineKeyboard();
  for (const column of nextColumns(task.columnKey)) {
    keyboard.text(`→ ${columnLabel(column)}`, `mv:${task.id}:${column}`);
  }
  keyboard.row();

  if (!task.isMine) keyboard.text('🙋 Беру себе', `as:${task.id}`);
  keyboard.text('💬 Комментарий', `rp:${task.id}`).row();
  keyboard
    .url('Открыть в браузере', `${appUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(task.key)}`)
    .row()
    .text('‹ Назад', backTo);

  return { text: lines.join('\n'), keyboard };
}

/** Соседние колонки: шаг вперёд и шаг назад. */
function nextColumns(current: string): string[] {
  const index = COLUMN_ORDER.indexOf(current as never);
  if (index < 0) return [];
  const result: string[] = [];
  if (index > 0) result.push(COLUMN_ORDER[index - 1] as string);
  if (index < COLUMN_ORDER.length - 1) result.push(COLUMN_ORDER[index + 1] as string);
  return result;
}

export function boardsScreen(boards: BoardLine[], purpose: 'open' | 'stats' | 'new'): Screen {
  const keyboard = new InlineKeyboard();

  const usable =
    purpose === 'stats'
      ? boards.filter((board) => board.role === 'OWNER' || board.role === 'ADMIN')
      : boards;

  for (const board of usable.slice(0, 12)) {
    const prefix = purpose === 'stats' ? 's' : purpose === 'new' ? 'nb' : 'b';
    const suffix = purpose === 'stats' ? ':7' : '';
    keyboard.text(`${board.name}${board.myTasks > 0 ? ` · ${board.myTasks}` : ''}`, `${prefix}:${board.id}${suffix}`).row();
  }

  keyboard.text('‹ Меню', 'm:home');

  const title =
    purpose === 'stats'
      ? '📊 По какой доске сводка?'
      : purpose === 'new'
        ? '➕ В какую доску добавить задачу?'
        : '🗂 Мои доски';

  const body =
    usable.length === 0
      ? purpose === 'stats'
        ? 'Сводка доступна владельцу доски и её администраторам. Таких досок у вас нет.'
        : 'Вы пока не состоите ни в одной доске.'
      : usable
          .map(
            (board) =>
              `<b>${escapeHtml(board.name)}</b> · ${escapeHtml(roleLabel(board.role))}` +
              (board.myTasks > 0 ? `\n<i>на вас: ${board.myTasks}</i>` : ''),
          )
          .join('\n\n');

  return { text: `<b>${title}</b>\n\n${body}`, keyboard };
}

export interface StatsData {
  board: { key: string; name: string };
  days: number;
  attention: {
    overdue: number;
    blocked: number;
    unassigned: number;
    stale: number;
    inProgress: number;
    dueThisWeek: number;
  };
  flow: {
    created: { current: number; previous: number };
    completed: { current: number; previous: number };
    cycleTimeDays: { current: number; previous: number };
    returned: { current: number; previous: number };
    reopened: { current: number; previous: number };
  };
  cycleTime: { median: number; p90: number; sample: number };
  people: {
    user: { id: string; displayName: string };
    active: number;
    overdue: number;
    completed: number;
  }[];
}

/**
 * Сводка по доске.
 *
 * Порядок тот же, что на дашборде: сначала то, с чем надо что-то делать,
 * потом результат за период, потом люди. Графиков в чате нет, поэтому
 * динамика показывается стрелкой к прошлому такому же периоду.
 */
export function statsScreen(stats: StatsData, boardId: string): Screen {
  const { attention: a, flow } = stats;

  const alerts = [
    a.overdue > 0 ? `🔴 Просрочено: <b>${a.overdue}</b>` : null,
    a.blocked > 0 ? `⛔ Заблокировано: <b>${a.blocked}</b>` : null,
    a.stale > 0 ? `🕸 Застряло без движения: <b>${a.stale}</b>` : null,
    a.unassigned > 0 ? `👤 Без исполнителя: <b>${a.unassigned}</b>` : null,
  ].filter(Boolean);

  const lines = [
    `📊 <b>${escapeHtml(stats.board.name)}</b> · ${stats.days} дн.`,
    '',
    alerts.length > 0 ? alerts.join('\n') : '✅ Ничего не горит',
    '',
    `⚙️ В работе: <b>${a.inProgress}</b> · 🕒 срок на неделе: <b>${a.dueThisWeek}</b>`,
    '',
    '<b>За период</b>',
    `Закрыто: <b>${flow.completed.current}</b> ${delta(flow.completed, 'up')}`,
    `Создано: <b>${flow.created.current}</b> ${delta(flow.created, 'down')}`,
    stats.cycleTime.sample > 0
      ? `Время цикла: <b>${stats.cycleTime.median} дн</b> ${delta(flow.cycleTimeDays, 'down')} · 90% ≤ ${stats.cycleTime.p90} дн`
      : 'Время цикла: пока не по чему считать',
    `Возвраты: <b>${flow.returned.current}</b> ${delta(flow.returned, 'down')} · переоткрыто: <b>${flow.reopened.current}</b>`,
  ];

  const people = stats.people.filter((person) => person.active > 0 || person.completed > 0);
  if (people.length > 0) {
    lines.push('', '<b>Люди</b>');
    for (const person of people.slice(0, 8)) {
      const marks = [
        `${person.active} в работе`,
        person.overdue > 0 ? `🔴 ${person.overdue}` : null,
        person.completed > 0 ? `✅ ${person.completed}` : null,
      ].filter(Boolean);
      lines.push(`${escapeHtml(person.user.displayName)} — ${marks.join(', ')}`);
    }
  }

  const keyboard = new InlineKeyboard()
    .text(stats.days === 7 ? '· 7 дней ·' : '7 дней', `s:${boardId}:7`)
    .text(stats.days === 30 ? '· 30 дней ·' : '30 дней', `s:${boardId}:30`)
    .text(stats.days === 90 ? '· 90 дней ·' : '90 дней', `s:${boardId}:90`)
    .row()
    .text('‹ Доски', 'm:st')
    .text('↻ Обновить', `s:${boardId}:${stats.days}`);

  return { text: lines.join('\n'), keyboard };
}

/** Стрелка сравнения с прошлым периодом. Куда «хорошо» — задаётся снаружи. */
function delta(value: { current: number; previous: number }, good: 'up' | 'down'): string {
  const diff = value.current - value.previous;
  if (diff === 0) return '';
  const better = good === 'up' ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '▲' : '▼';
  return `<i>${arrow}${Math.abs(diff)} ${better ? '👍' : ''}</i>`.trim();
}

function roleLabel(role: string): string {
  if (role === 'OWNER') return 'владелец';
  if (role === 'ADMIN') return 'администратор';
  if (role === 'VIEWER') return 'наблюдатель';
  return 'участник';
}

function trim(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
