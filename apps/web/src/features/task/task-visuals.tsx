import * as React from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  Bug,
  ChevronsDown,
  ChevronsUp,
  CircleDot,
  Flame,
  Layers,
  Minus,
  Wrench,
} from 'lucide-react';
import {
  DUE_STATE_LABELS,
  PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  formatDueRelative,
  getDueState,
  type DueState,
  type TaskPriority,
  type TaskType,
} from '@kaif/shared';
import { cn, formatFullDateTime } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

/** Единая визуальная семантика задач: тип, приоритет, срочность. */

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  TASK: <CircleDot />,
  BUG: <Bug />,
  STORY: <Layers />,
  EPIC: <Layers />,
  CHORE: <Wrench />,
};

const TYPE_COLORS: Record<TaskType, string> = {
  TASK: 'text-sky-500',
  BUG: 'text-red-500',
  STORY: 'text-emerald-500',
  EPIC: 'text-violet-500',
  CHORE: 'text-slate-500',
};

export function TaskTypeIcon({
  type,
  className,
}: {
  type: TaskType;
  className?: string;
}): React.ReactElement {
  return (
    <Tooltip content={TASK_TYPE_LABELS[type]}>
      <span className={cn('inline-flex [&_svg]:size-3.5', TYPE_COLORS[type], className)}>
        {TYPE_ICONS[type]}
      </span>
    </Tooltip>
  );
}

const PRIORITY_ICONS: Record<TaskPriority, React.ReactNode> = {
  BLOCKER: <AlertOctagon />,
  URGENT: <Flame />,
  HIGH: <ChevronsUp />,
  MEDIUM: <Minus />,
  LOW: <ArrowDown />,
  LOWEST: <ChevronsDown />,
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  BLOCKER: 'text-red-600',
  URGENT: 'text-orange-500',
  HIGH: 'text-amber-500',
  MEDIUM: 'text-slate-400',
  LOW: 'text-sky-500',
  LOWEST: 'text-slate-400',
};

export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}): React.ReactElement {
  return (
    <Tooltip content={`Приоритет: ${PRIORITY_LABELS[priority]}`}>
      <span className={cn('inline-flex [&_svg]:size-3.5', PRIORITY_COLORS[priority], className)}>
        {PRIORITY_ICONS[priority]}
      </span>
    </Tooltip>
  );
}

export { ArrowUp };

// ────────────────────────────────── Дедлайн ─────────────────────────────────

const DUE_STYLES: Record<DueState, string> = {
  overdue: 'bg-destructive/12 text-destructive',
  today: 'bg-warning/15 text-warning',
  soon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  upcoming: 'bg-secondary text-muted-foreground',
  normal: 'bg-secondary text-muted-foreground',
  none: 'bg-secondary text-muted-foreground',
  done: 'bg-success/12 text-success',
};

export function DueBadge({
  dueDate,
  completed,
  timeZone,
  className,
  showLabel = false,
}: {
  dueDate: string | null;
  completed?: boolean;
  timeZone?: string;
  className?: string;
  showLabel?: boolean;
}): React.ReactElement | null {
  if (!dueDate) return null;

  const state = getDueState(dueDate, {
    completed: completed ?? false,
    ...(timeZone ? { timeZone } : {}),
  });

  // Подпись — законченная фраза, а не склейка названия состояния со
  // значением: из такой склейки получалось «Сегодня: Сегодня».
  const label = dueLabel(state, dueDate, showLabel, timeZone);

  return (
    <Tooltip content={`${DUE_STATE_LABELS[state]} · ${formatFullDateTime(dueDate)}`}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
          DUE_STYLES[state],
          className,
        )}
      >
        {state === 'overdue' && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
        {label}
      </span>
    </Tooltip>
  );
}

/**
 * Что написать на значке срока.
 *
 * Коротко — на карточке доски, где место дорого. Полностью — в карточке
 * задачи, где значок стоит рядом с датой и должен объяснять, что она значит.
 */
function dueLabel(
  state: DueState,
  dueDate: string,
  full: boolean,
  timeZone?: string,
): string {
  if (state === 'done') return 'Закрыта в срок или позже';
  if (state === 'today') {
    const time = formatTimeOfDay(dueDate, timeZone);
    return full ? `Сегодня до ${time}` : `Сегодня, ${time}`;
  }
  if (state === 'overdue') {
    const relative = formatDueRelative(dueDate);
    return full ? capitalize(relative) : relative;
  }

  const relative = formatDueRelative(dueDate);
  return full ? `${DUE_STATE_LABELS[state]} · ${relative}` : relative;
}

function formatTimeOfDay(value: string, timeZone?: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Рамка карточки, подсвечивающая срочность. */
export function dueCardAccent(dueDate: string | null, completed: boolean, timeZone?: string): string {
  if (!dueDate) return '';
  const state = getDueState(dueDate, { completed, ...(timeZone ? { timeZone } : {}) });
  switch (state) {
    case 'overdue':
      return 'border-destructive/60 shadow-[0_0_0_1px_hsl(var(--destructive)/0.25)]';
    case 'today':
      return 'border-warning/60';
    case 'soon':
      return 'border-amber-400/50';
    default:
      return '';
  }
}
