import * as React from 'react';
import { CalendarClock, History, PlayCircle, Repeat2 } from 'lucide-react';
import { getDueState, type TaskDetailDto } from '@kaif/shared';
import { formatFullDateTime } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Что происходит со сроком этой задачи.
 *
 * Одной даты мало: важно, взялся ли кто-то за работу, сколько она уже идёт,
 * успели ли к сроку и не переносили ли его. Раньше рядом с дедлайном была
 * «дата начала», которую надо было проставлять руками — её никто не ставил,
 * а настоящее начало и так известно: момент, когда карточку перетащили
 * в «В работе».
 */
export function DueSummary({
  task,
  timeZone,
}: {
  task: TaskDetailDto;
  timeZone?: string;
}): React.ReactElement | null {
  const rows: { icon: React.ReactNode; text: string; tone?: 'danger' | 'success' }[] = [];

  if (task.firstInProgressAt) {
    const started = new Date(task.firstInProgressAt);
    const until = task.completedAt ? new Date(task.completedAt) : new Date();
    rows.push({
      icon: <PlayCircle />,
      text: task.completedAt
        ? `В работе была ${humanDuration(started, until)}`
        : `В работе ${humanDuration(started, until)}`,
    });
  }

  // Успели или нет — видно только когда есть и срок, и факт закрытия.
  if (task.completedAt && task.dueDate) {
    const done = new Date(task.completedAt);
    const due = new Date(task.dueDate);
    const late = done.getTime() > due.getTime();
    rows.push({
      icon: <CalendarClock />,
      text: late
        ? `Закрыта с опозданием на ${humanDuration(due, done)}`
        : `Закрыта раньше срока на ${humanDuration(done, due)}`,
      tone: late ? 'danger' : 'success',
    });
  }

  if (task.dueDateChangedCount > 0) {
    rows.push({
      icon: <Repeat2 />,
      text: `Срок переносили ${task.dueDateChangedCount} ${plural(task.dueDateChangedCount)}`,
      ...(task.dueDateChangedCount >= 3 ? { tone: 'danger' as const } : {}),
    });
  }

  if (rows.length === 0) {
    // Задача ещё не в работе — говорим об этом прямо, а не молчим.
    if (!task.dueDate) return null;
    const state = getDueState(task.dueDate, {
      completed: false,
      ...(timeZone ? { timeZone } : {}),
    });
    if (state !== 'overdue') return null;
    return (
      <Row
        icon={<History />}
        text="За задачу ещё никто не брался"
        tone="danger"
        title={formatFullDateTime(task.dueDate)}
      />
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <Row key={row.text} icon={row.icon} text={row.text} {...(row.tone ? { tone: row.tone } : {})} />
      ))}
    </div>
  );
}

function Row({
  icon,
  text,
  tone,
  title,
}: {
  icon: React.ReactNode;
  text: string;
  tone?: 'danger' | 'success';
  title?: string;
}): React.ReactElement {
  const content = (
    <p
      className={cn(
        'flex items-center gap-1.5 text-[11px] [&_svg]:size-3.5 [&_svg]:shrink-0',
        tone === 'danger'
          ? 'text-destructive'
          : tone === 'success'
            ? 'text-success'
            : 'text-muted-foreground',
      )}
    >
      {icon}
      {text}
    </p>
  );
  return title ? <Tooltip content={title}>{content}</Tooltip> : content;
}

/** «3 дня», «5 часов», «40 минут» — без секунд и без хвостов. */
function humanDuration(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${pluralWord(hours, 'час', 'часа', 'часов')}`;

  const days = Math.round(hours / 24);
  return `${days} ${pluralWord(days, 'день', 'дня', 'дней')}`;
}

function plural(count: number): string {
  return pluralWord(count, 'раз', 'раза', 'раз');
}

function pluralWord(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
