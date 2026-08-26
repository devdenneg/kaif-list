import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  ListTodo,
  Pause,
  Play,
  Plus,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { COLUMN_LABELS, type ColumnKey, type TaskCardDto } from '@kaif/shared';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SortableTaskCard } from './sortable-task-card';
import { QuickAddTask, type TaskDefaults } from './quick-add-task';

/** Цветовой акцент колонки — помогает ориентироваться боковым зрением. */
const COLUMN_ACCENT: Record<ColumnKey, string> = {
  TODO: 'bg-slate-400',
  ON_HOLD: 'bg-amber-500',
  IN_PROGRESS: 'bg-sky-500',
  QA: 'bg-violet-500',
  READY_TO_RELEASE: 'bg-teal-500',
  DONE: 'bg-emerald-500',
};

/** В свёрнутом виде длинные названия заменяем узнаваемой пиктограммой и короткой подписью. */
const COLLAPSED_COLUMN_META: Record<ColumnKey, { label: string; icon: LucideIcon }> = {
  TODO: { label: 'План', icon: ListTodo },
  ON_HOLD: { label: 'Пауза', icon: Pause },
  IN_PROGRESS: { label: 'Работа', icon: Play },
  QA: { label: 'Тест', icon: FlaskConical },
  READY_TO_RELEASE: { label: 'Релиз', icon: Rocket },
  DONE: { label: 'Готово', icon: CheckCheck },
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
  /** Признак дорожки, если доска сгруппирована. */
  taskDefaults?: TaskDefaults;
  canCreate: boolean;
  canDrag: boolean;
  timeZone?: string;
  /** Мобильная раскладка: колонка занимает почти весь экран. */
  mobile?: boolean;
}

export function BoardColumn({
  boardId,
  columnKey,
  taskDefaults,
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
    const collapsedMeta = COLLAPSED_COLUMN_META[columnKey];
    const CollapsedIcon = collapsedMeta.icon;

    return (
      <div className="snap-column w-14 shrink-0 self-start overflow-hidden rounded-xl transition-[width] duration-200 ease-out motion-reduce:transition-none">
        <Tooltip
          side="right"
          content={
            <span className="block text-center">
              <span className="block font-medium">{name}</span>
              <span className="block text-[10px] opacity-75">
                Задач: {tasks.length}
                {wipLimit !== null ? ` · WIP ${tasks.length}/${wipLimit}` : ''}
              </span>
              <span className="mt-0.5 block text-[10px] opacity-60">Нажмите, чтобы развернуть</span>
            </span>
          }
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              'glass-column group relative flex h-28 w-full animate-fade-in flex-col items-center gap-1.5 overflow-hidden rounded-xl border px-1.5 py-2 motion-reduce:animate-none',
              'text-muted-foreground transition-[border-color,background-color,box-shadow] hover:border-primary/35 hover:bg-secondary/45',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:ring-offset-0',
              overLimit ? 'border-destructive/60' : 'border-border',
            )}
            aria-label={`Развернуть колонку ${name}`}
          >
            <span
              className={cn('absolute inset-x-0 top-0 h-0.5', COLUMN_ACCENT[columnKey])}
              aria-hidden
            />
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-background">
              <CollapsedIcon className="size-[18px]" aria-hidden />
            </span>
            <span className="w-full truncate text-center text-[10px] font-medium leading-4">
              {collapsedMeta.label}
            </span>
            <span
              className={cn(
                'min-w-6 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums',
                overLimit
                  ? 'bg-destructive/15 text-destructive'
                  : atLimit
                    ? 'bg-warning/15 text-warning'
                    : 'bg-secondary text-muted-foreground',
              )}
            >
              {tasks.length}
            </span>
            <ChevronRight className="mt-auto size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      id={`column-${columnKey}`}
      role={mobile ? 'tabpanel' : undefined}
      aria-labelledby={mobile ? `mobile-column-tab-${columnKey}` : undefined}
      className={cn(
        'snap-column h-full max-h-full shrink-0 self-start overflow-hidden rounded-xl transition-[width] duration-200 ease-out motion-reduce:transition-none',
        mobile
          ? 'w-full basis-full pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]'
          : 'w-72 xl:w-80',
      )}
    >
      <section
        className={cn(
          'glass-column flex min-h-0 max-h-full w-full animate-fade-in flex-col overflow-hidden rounded-xl border transition-colors motion-reduce:animate-none',
          mobile ? 'h-full' : 'min-w-72 xl:min-w-80',
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
            'scrollbar-thin flex min-h-0 flex-1 touch-manipulation flex-col gap-2 overflow-y-auto p-2 pb-4 scroll-pb-4 transition-[min-height]',
            tasks.length === 0 && 'min-h-36',
            tasks.length === 0 && isDragging && 'min-h-64',
          )}
        >
          {quickAddOpen && (
            <QuickAddTask
              boardId={boardId}
              columnKey={columnKey}
              {...(taskDefaults ? { defaults: taskDefaults } : {})}
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
    </div>
  );
}
