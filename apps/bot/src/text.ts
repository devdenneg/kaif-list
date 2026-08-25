import { COLUMN_LABELS, PRIORITY_LABELS, formatDueRelative, type ColumnKey } from '@kaif/shared';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COLUMN_ICONS: Record<string, string> = {
  TODO: '📋',
  ON_HOLD: '⏸️',
  IN_PROGRESS: '⚙️',
  QA: '🔍',
  READY_TO_RELEASE: '📦',
  DONE: '✅',
};

const PRIORITY_ICONS: Record<string, string> = {
  BLOCKER: '⛔',
  URGENT: '🔥',
  HIGH: '🔺',
  MEDIUM: '',
  LOW: '🔻',
  LOWEST: '',
};

export interface TaskLine {
  key: string;
  title: string;
  columnKey: string;
  priority: string;
  dueDate: string | null;
  boardName: string;
}

export function formatTaskList(tasks: TaskLine[], appUrl: string, emptyText: string): string {
  if (tasks.length === 0) return emptyText;

  return tasks
    .map((task) => {
      const icon = COLUMN_ICONS[task.columnKey] ?? '•';
      const priority = PRIORITY_ICONS[task.priority] ?? '';
      const link = `${appUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(task.key)}`;

      const parts = [
        `${icon} <a href="${link}"><b>${escapeHtml(task.key)}</b></a> ${escapeHtml(task.title)}`,
      ];

      const meta: string[] = [escapeHtml(task.boardName)];
      if (task.dueDate) {
        const overdue = new Date(task.dueDate).getTime() < Date.now();
        meta.push(`${overdue ? '🔴' : '🕒'} ${escapeHtml(formatDueRelative(task.dueDate))}`);
      }
      if (priority) meta.push(`${priority} ${escapeHtml(PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS] ?? '')}`);
      parts.push(`<i>${meta.join(' · ')}</i>`);

      return parts.join('\n');
    })
    .join('\n\n');
}

export function columnLabel(key: string): string {
  return COLUMN_LABELS[key as ColumnKey] ?? key;
}
