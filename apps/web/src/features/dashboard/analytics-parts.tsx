import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { COLUMN_LABELS, PRIORITY_LABELS, type AttentionTaskDto, type MetricDelta } from '@kaif/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** Кирпичики дашборда: плитки, дельты, списки задач. */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section
      className={cn('rounded-xl border border-border bg-card p-4 shadow-card', className)}
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Плитка «требует внимания».
 *
 * Ведёт на доску с уже выставленным фильтром: смотреть на число бессмысленно,
 * если из него нельзя сразу попасть к задачам.
 */
export function AttentionTile({
  label,
  value,
  tone = 'default',
  to,
  hint,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  to?: string;
  hint?: string;
}): React.ReactElement {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          value === 0
            ? 'text-muted-foreground'
            : tone === 'danger'
              ? 'text-destructive'
              : tone === 'warning'
                ? 'text-warning'
                : tone === 'success'
                  ? 'text-success'
                  : 'text-foreground',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </>
  );

  const className = cn(
    'rounded-xl border bg-card p-3 text-left shadow-card transition-colors',
    value > 0 && tone === 'danger' ? 'border-destructive/40' : 'border-border',
    to && 'hover:border-primary/60',
  );

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Число за период рядом с прошлым таким же периодом.
 *
 * Само по себе «закрыто 12» не говорит ничего: важно, больше это или меньше,
 * чем было. Направление «хорошо» задаётся снаружи — для времени цикла
 * и возвратов рост это плохо, для закрытых задач наоборот.
 */
export function DeltaStat({
  label,
  delta,
  unit,
  goodDirection = 'up',
  hint,
}: {
  label: string;
  delta: MetricDelta;
  unit?: string;
  goodDirection?: 'up' | 'down';
  hint?: string;
}): React.ReactElement {
  const diff = delta.current - delta.previous;
  const percent =
    delta.previous > 0 ? Math.round((diff / delta.previous) * 100) : diff > 0 ? 100 : 0;
  const good = diff === 0 ? null : goodDirection === 'up' ? diff > 0 : diff < 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {formatNumber(delta.current)}
          {unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
        </span>
        {diff !== 0 && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-xs font-medium [&_svg]:size-3',
              good === null
                ? 'text-muted-foreground'
                : good
                  ? 'text-success'
                  : 'text-destructive',
            )}
          >
            {diff > 0 ? <ArrowUp /> : <ArrowDown />}
            {Math.abs(percent)}%
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {hint ?? `было ${formatNumber(delta.previous)}${unit ?? ''}`}
      </p>
    </div>
  );
}

/** Короткий список задач: ключ, заголовок, кто и почему обращает на себя внимание. */
export function AttentionList({
  tasks,
  empty,
  reason,
}: {
  tasks: AttentionTaskDto[];
  empty: string;
  reason: (task: AttentionTaskDto) => string;
}): React.ReactElement {
  if (tasks.length === 0) {
    return <p className="py-3 text-center text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="space-y-0.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link
            to={`/tasks/${task.key}`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-secondary"
          >
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{task.key}</span>
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
            {task.assignee ? (
              <UserAvatar user={task.assignee} size="xs" />
            ) : (
              <span className="shrink-0 text-[10px] text-muted-foreground">не назначена</span>
            )}
            <span className="shrink-0 text-[11px] text-muted-foreground">{reason(task)}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Горизонтальная полоса — для распределений, где важна пропорция, а не точка. */
export function BarRow({
  label,
  value,
  max,
  suffix,
  color,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  color?: string;
}): React.ReactElement {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate text-muted-foreground">{label}</span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
        <span
          className="block h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: color ?? 'hsl(var(--primary))' }}
        />
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums">
        {formatNumber(value)}
        {suffix}
      </span>
    </div>
  );
}

export const COLUMN_LABEL = COLUMN_LABELS;
export const PRIORITY_LABEL = PRIORITY_LABELS;

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
