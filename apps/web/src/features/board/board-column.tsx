import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { COLUMN_LABELS, type ColumnKey, type TaskCardDto } from '@kaif/shared';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SortableTaskCard } from './sortable-task-card';
import { QuickAddTask } from './quick-add-task';

/** Цветовой акцент колонки — помогает ориентироваться боковым зрением. */
const COLUMN_ACCENT: Record<ColumnKey, string> = {
  TODO: 'bg-slate-400',
  ON_HOLD: 'bg-amber-500',
  IN_PROGRESS: 'bg-sky-500',
  QA: 'bg-violet-500',
  READY_TO_RELEASE: 'bg-teal-500',
  DONE: 'bg-emerald-500',
};

export interface BoardColumnProps {
  boardId: string;
  columnKey: ColumnKey;
  name: string;
  tasks: TaskCardDto[];
  wipLimit: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenTask: (task: TaskCardDto) => void;
  onCreateTask?: (columnKey: ColumnKey) => void;
  canCreate: boolean;
  canDrag: boolean;
  timeZone?: string;
  /** Мобильная раскладка: колонка занимает почти весь экран. */
  mobile?: boolean;
}

export function BoardColumn({
  boardId,
  columnKey,
  name,
  tasks,
  wipLimit,
  collapsed,
  onToggleCollapse,
  onOpenTask,
  canCreate,
  canDrag,
  timeZone,
  mobile,
}: BoardColumnProps): React.ReactElement {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `column:${columnKey}`,
    data: { type: 'column', columnKey },
  });

  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const overLimit = wipLimit !== null && tasks.length > wipLimit;
  const atLimit = wipLimit !== null && tasks.length === wipLimit;
  const isDragging = active !== null;

  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 self-start flex-col items-center gap-2 rounded-xl border border-border bg-surface py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          aria-label={`Развернуть колонку ${name}`}
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="text-xs font-medium text-muted-foreground">{tasks.length}</span>
        <span
          className="mt-1 flex-1 select-none text-xs font-medium text-muted-foreground"
          style={{ writingMode: 'vertical-rl' }}
        >
          {name}
        </span>
      </div>
    );
  }

  return (
    <section
      id={`column-${columnKey}`}
      className={cn(
        'snap-column flex max-h-full shrink-0 self-start flex-col overflow-hidden rounded-xl border bg-surface transition-colors',
        mobile ? 'w-[86vw] max-w-sm' : 'w-72 xl:w-80',
        isOver ? 'border-primary/60 bg-accent/30' : 'border-border',
      )}
      aria-label={`Колонка ${name}`}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span
          className={cn('size-2 shrink-0 rounded-full', COLUMN_ACCENT[columnKey])}
          aria-hidden
        />
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {name || COLUMN_LABELS[columnKey]}
        </h2>

        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            overLimit
              ? 'bg-destructive/15 text-destructive'
              : atLimit
                ? 'bg-warning/15 text-warning'
                : 'bg-secondary text-muted-foreground',
          )}
        >
          {tasks.length}
          {wipLimit !== null && `/${wipLimit}`}
        </span>

        {overLimit && (
          <Tooltip content="Превышен лимит одновременной работы — сначала завершите начатое">
            <span className="text-[11px] font-medium text-destructive">WIP</span>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {canCreate && (
            <Tooltip content="Быстро добавить задачу">
              <Button
                variant="ghost"
                size="icon-sm"
                className={mobile ? 'size-10' : undefined}
                onClick={() => setQuickAddOpen(true)}
                aria-label="Добавить задачу"
              >
                <Plus />
              </Button>
            </Tooltip>
          )}
          {!mobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleCollapse}
              aria-label={`Свернуть колонку ${name}`}
            >
              <ChevronDown />
            </Button>
          )}
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'scrollbar-thin flex min-h-0 flex-1 touch-manipulation flex-col gap-2 overflow-y-auto overscroll-y-contain p-2 pb-4 scroll-pb-4 transition-[min-height]',
          tasks.length === 0 && 'min-h-36',
          tasks.length === 0 && isDragging && 'min-h-64',
        )}
      >
        {quickAddOpen && (
          <QuickAddTask
            boardId={boardId}
            columnKey={columnKey}
            onClose={() => setQuickAddOpen(false)}
          />
        )}

        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              columnKey={columnKey}
              onOpen={onOpenTask}
              disabled={!canDrag}
              {...(timeZone ? { timeZone } : {})}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !quickAddOpen && (
          <div
            className={cn(
              'flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs transition-colors',
              isOver
                ? 'border-primary/60 bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            <span>{isOver ? 'Отпустите задачу здесь' : 'В колонке пока нет задач'}</span>
            {canCreate && !isDragging && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setQuickAddOpen(true)}
              >
                <Plus />
                Добавить задачу
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
