import * as React from 'react';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, ChevronRight, Link2, Trash2 } from 'lucide-react';
import {
  COLUMN_LABELS,
  ColumnKey,
  TASK_LINK_LABELS,
  TaskLinkType,
  type TaskDetailDto,
  type TaskLinkDto,
} from '@kaif/shared';
import { cn } from '@/lib/utils';

/**
 * Связанные задачи.
 *
 * Смысл списка — не перечислить ключи, а сразу показать, что мешает работать.
 * Поэтому связи сгруппированы по типу, блокирующие идут первыми, у каждой
 * задачи видно, в какой она колонке, а закрытые блокеры больше не выглядят
 * как преграда.
 */

/** Блокирующие связи наверх: ради них список и открывают. */
const TYPE_ORDER: TaskLinkType[] = [
  TaskLinkType.BLOCKED_BY,
  TaskLinkType.BLOCKS,
  TaskLinkType.DUPLICATES,
  TaskLinkType.DUPLICATED_BY,
  TaskLinkType.RELATES,
];

export function TaskLinks({
  task,
  onDelete,
  canManage,
}: {
  task: TaskDetailDto;
  onDelete: (linkId: string) => void;
  canManage: boolean;
}): React.ReactElement {
  if (task.links.length === 0) {
    return <span className="text-xs text-muted-foreground">Связей пока нет</span>;
  }

  const byType = new Map<TaskLinkType, TaskLinkDto[]>();
  for (const link of task.links) {
    const list = byType.get(link.type) ?? [];
    list.push(link);
    byType.set(link.type, list);
  }

  return (
    <div className="min-w-0 flex-1 space-y-2.5">
      {TYPE_ORDER.filter((type) => byType.has(type)).map((type) => (
        <div key={type}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {TASK_LINK_LABELS[type]}
          </p>
          <ul className="space-y-0.5">
            {(byType.get(type) ?? []).map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                canManage={canManage}
                onDelete={() => onDelete(link.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LinkRow({
  link,
  canManage,
  onDelete,
}: {
  link: TaskLinkDto;
  canManage: boolean;
  onDelete: () => void;
}): React.ReactElement {
  const done = link.task.columnKey === ColumnKey.DONE || link.task.isArchived;
  // Активной преградой считается только незакрытый блокер.
  const blocking = link.type === TaskLinkType.BLOCKED_BY && !done;

  return (
    <li
      className={cn(
        'group flex min-h-10 items-start gap-2 rounded-md border px-2 py-2 text-xs transition-colors',
        blocking
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-transparent hover:border-border hover:bg-secondary/50',
      )}
    >
      {blocking ? (
        <Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="мешает продолжить" />
      ) : done ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="закрыта" />
      ) : (
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <Link
          to={`/tasks/${link.task.key}`}
          className={cn(
            'line-clamp-2 font-medium leading-4 hover:underline',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          <span className="font-mono text-[11px] text-muted-foreground">{link.task.key}</span>{' '}
          {link.task.title}
        </Link>

        <span
          className={cn(
            'mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium sm:hidden',
            done ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground',
          )}
        >
          {link.task.isArchived ? 'в архиве' : COLUMN_LABELS[link.task.columnKey]}
        </span>
      </div>

      <span
        className={cn(
          'hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex',
          done ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground',
        )}
      >
        {link.task.isArchived ? 'в архиве' : COLUMN_LABELS[link.task.columnKey]}
      </span>

      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:size-9 [@media(pointer:coarse)]:opacity-100"
          aria-label={`Убрать связь с ${link.task.key}`}
        >
          <Trash2 className="size-3.5 text-muted-foreground" />
        </button>
      )}
    </li>
  );
}

/**
 * Блок связей в основной колонке, сразу под вложениями.
 *
 * В боковой панели связи тоже есть, но там они соседствуют с приоритетом
 * и оценкой — а «что мешает» и «что ждёт нас» человек читает вместе с
 * описанием, а не в списке свойств.
 */
export function TaskLinksSection({
  task,
  onDelete,
  onAdd,
  canManage,
}: {
  task: TaskDetailDto;
  onDelete: (linkId: string) => void;
  onAdd: React.ReactNode;
  canManage: boolean;
}): React.ReactElement | null {
  // Пустой блок в основной колонке не нужен: добавить связь можно из панели.
  if (task.links.length === 0 && !canManage) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex min-h-9 items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Связи</h3>
        {task.links.length > 0 && (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {task.links.length}
          </span>
        )}
        <div className="ml-auto -mr-2">{onAdd}</div>
      </div>

      {task.links.length === 0 ? (
        <p className="rounded-lg bg-background/25 px-3 py-2.5 text-left text-sm leading-5 text-muted-foreground">
          Связей пока нет. Добавьте блокер или зависимую задачу, если они есть.
        </p>
      ) : (
        <TaskLinks task={task} onDelete={onDelete} canManage={canManage} />
      )}
    </section>
  );
}

/**
 * Полоса «задача заблокирована» вверху карточки.
 *
 * Самое важное сообщение о задаче: пока держит блокер, браться за неё
 * бессмысленно. Ссылки ведут прямо к тому, чего ждём.
 */
export function BlockedBanner({ task }: { task: TaskDetailDto }): React.ReactElement | null {
  const blockers = task.links.filter(
    (link) =>
      link.type === TaskLinkType.BLOCKED_BY &&
      link.task.columnKey !== ColumnKey.DONE &&
      !link.task.isArchived,
  );
  if (blockers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <Ban className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">
        {blockers.length === 1
          ? 'Задача заблокирована'
          : `Задачу держат ${blockers.length} блокера`}
      </span>
      <span className="opacity-80">·</span>
      {blockers.map((link, index) => (
        <React.Fragment key={link.id}>
          {index > 0 && <span className="opacity-60">,</span>}
          <Link
            to={`/tasks/${link.task.key}`}
            className="font-mono underline-offset-2 hover:underline"
          >
            {link.task.key}
          </Link>
        </React.Fragment>
      ))}
    </div>
  );
}
