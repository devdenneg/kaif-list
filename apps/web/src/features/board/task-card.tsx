import * as React from 'react';
import { CheckSquare, MessageSquare, Paperclip, ShieldAlert } from 'lucide-react';
import type { TaskCardDto } from '@kaif/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { LabelChip } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DueBadge, PriorityIcon, TaskTypeIcon, dueCardAccent } from '@/features/task/task-visuals';
import { TaskCardMenu } from './task-card-menu';
import { useTaskActions } from './task-actions-context';

export interface TaskCardProps {
  task: TaskCardDto;
  onOpen?: (task: TaskCardDto) => void;
  timeZone?: string;
  /** Карточка сейчас перетаскивается — приглушаем оригинал. */
  isDragging?: boolean;
  /** Отображение в оверлее перетаскивания. */
  isOverlay?: boolean;
  className?: string;
  compact?: boolean;
}

/**
 * Карточка задачи.
 *
 * Плотность информации подобрана так, чтобы с одного взгляда было понятно:
 * что за задача, на ком она, горит ли срок и есть ли обсуждение.
 */
export const TaskCard = React.memo(function TaskCard({
  task,
  onOpen,
  timeZone,
  isDragging,
  isOverlay,
  className,
  compact,
}: TaskCardProps): React.ReactElement {
  const completed = task.completedAt !== null;
  const accent = dueCardAccent(task.dueDate, completed, timeZone);
  const actions = useTaskActions();
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <article
      onClick={() => onOpen?.(task)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(task);
        }
      }}
      onContextMenu={(event) => {
        // Правая кнопка на карточке открывает то же меню, что и «…».
        if (!actions) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      role="button"
      tabIndex={0}
      aria-label={`${task.key}: ${task.title}`}
      className={cn(
        'group relative select-none rounded-lg border bg-card p-2.5 text-left shadow-card transition-all',
        'hover:border-primary/40 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        accent || 'border-border',
        isDragging && 'opacity-40',
        isOverlay && 'rotate-2 cursor-grabbing shadow-dragging',
        completed && 'opacity-75',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <TaskTypeIcon type={task.type} />
        <span className="font-mono text-[11px] font-medium text-muted-foreground">{task.key}</span>
        <div className="ml-auto flex items-center gap-1">
          {task.blockedByCount > 0 && (
            <Tooltip content={`Заблокирована: ${task.blockedByCount}`}>
              <span className="inline-flex text-destructive [&_svg]:size-3.5">
                <ShieldAlert />
              </span>
            </Tooltip>
          )}
          <PriorityIcon priority={task.priority} />
          {!isOverlay && (
            <TaskCardMenu task={task} open={menuOpen} onOpenChange={setMenuOpen} />
          )}
        </div>
      </div>

      <p
        className={cn(
          'text-sm font-medium leading-snug text-foreground',
          compact ? 'line-clamp-1' : 'line-clamp-3',
          completed && 'line-through decoration-muted-foreground/50',
        )}
      >
        {task.title}
      </p>

      {task.labels.length > 0 && !compact && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
          {task.labels.length > 3 && (
            <span className="text-[11px] text-muted-foreground">+{task.labels.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <DueBadge dueDate={task.dueDate} completed={completed} {...(timeZone ? { timeZone } : {})} />

        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {task.checklistTotal > 0 && (
            <Tooltip content="Чек-лист">
              <span
                className={cn(
                  'inline-flex items-center gap-0.5',
                  task.checklistDone === task.checklistTotal && 'text-success',
                )}
              >
                <CheckSquare className="size-3" />
                {task.checklistDone}/{task.checklistTotal}
              </span>
            </Tooltip>
          )}
          {task.commentCount > 0 && (
            <Tooltip content="Комментарии">
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="size-3" />
                {task.commentCount}
              </span>
            </Tooltip>
          )}
          {task.attachmentCount > 0 && (
            <Tooltip content="Вложения">
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="size-3" />
                {task.attachmentCount}
              </span>
            </Tooltip>
          )}

          {task.tester && task.columnKey === 'QA' && (
            <UserAvatar user={task.tester} size="xs" withTooltip />
          )}
          <UserAvatar user={task.assignee} size="sm" withTooltip />
        </div>
      </div>
    </article>
  );
});
