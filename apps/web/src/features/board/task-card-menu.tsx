import * as React from 'react';
import {
  Archive,
  CalendarClock,
  CalendarX2,
  Copy,
  CopyPlus,
  Gauge,
  Link2,
  MoreHorizontal,
  Play,
  UserPlus,
  UserX,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_LABELS,
  TaskPriority,
  type TaskCardDto,
} from '@kaif/shared';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { PriorityIcon } from '@/features/task/task-visuals';
import { useTaskActions } from './task-actions-context';

/**
 * Меню быстрых действий на карточке.
 *
 * Смысл — не открывать задачу ради одного клика: взять в работу, поменять
 * исполнителя, сдвинуть срок и переложить в другую колонку можно прямо с доски.
 * Это же меню открывается правой кнопкой мыши по карточке.
 */
export function TaskCardMenu({
  task,
  open,
  onOpenChange,
  className,
}: {
  task: TaskCardDto;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}): React.ReactElement | null {
  const actions = useTaskActions();
  if (!actions) return null;

  const stop = (event: React.MouseEvent | React.KeyboardEvent): void => event.stopPropagation();

  const alreadyMine = task.assignee?.id === actions.currentUserId;
  const canTake = actions.canMove && (!alreadyMine || task.columnKey !== 'IN_PROGRESS');

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={stop}
          // Гасим событие до dnd-kit: нажатие на кнопку меню не должно
          // начинать перетаскивание карточки.
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onKeyDown={stop}
          aria-label={`Действия с задачей ${task.key}`}
          className={cn(
            'inline-flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
            // На тач-устройствах наведения нет, поэтому кнопка видна всегда.
            'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:size-9 [@media(pointer:coarse)]:p-0 [@media(pointer:coarse)]:opacity-100',
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" onClick={stop} className="w-56">
        {canTake && (
          <>
            <DropdownMenuItem onSelect={() => actions.takeInProgress(task)}>
              <Play />
              Взять в работу
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {actions.canEdit && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserPlus />
              Исполнитель
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto scrollbar-thin">
              {actions.currentUserId && !alreadyMine && (
                <>
                  <DropdownMenuItem
                    onSelect={() => actions.assign(task, actions.currentUserId ?? null)}
                  >
                    <UserPlus />
                    Назначить на себя
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {actions.board.members.map((member) => (
                <DropdownMenuItem
                  key={member.userId}
                  onSelect={() => actions.assign(task, member.userId)}
                >
                  <UserAvatar user={member.user} size="xs" />
                  <span className="truncate">{member.user.displayName}</span>
                </DropdownMenuItem>
              ))}
              {task.assignee && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => actions.assign(task, null)}>
                    <UserX />
                    Снять исполнителя
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {actions.canMove && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Gauge />
              Переместить
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {COLUMN_ORDER.filter((column) => column !== task.columnKey).map((column) => (
                <DropdownMenuItem key={column} onSelect={() => actions.move(task, column)}>
                  {actions.board.columns.find((item) => item.key === column)?.name ??
                    COLUMN_LABELS[column]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {actions.canEdit && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PriorityIcon priority={task.priority} />
                Приоритет
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {Object.values(TaskPriority).map((priority) => (
                  <DropdownMenuItem
                    key={priority}
                    onSelect={() => actions.setPriority(task, priority)}
                  >
                    <PriorityIcon priority={priority} />
                    {PRIORITY_LABELS[priority]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarClock />
                Срок
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Конец рабочего дня</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => actions.setDueDate(task, endOfDay(0))}>
                  Сегодня
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.setDueDate(task, endOfDay(1))}>
                  Завтра
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.setDueDate(task, endOfDay(7))}>
                  Через неделю
                </DropdownMenuItem>
                {task.dueDate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => actions.setDueDate(task, null)}>
                      <CalendarX2 />
                      Убрать срок
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard
              .writeText(`${window.location.origin}/tasks/${task.key}`)
              .then(() => toast.success('Ссылка скопирована'))
              .catch(() => toast.error('Не удалось скопировать'));
          }}
        >
          <Link2 />
          Копировать ссылку
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(task.key);
            toast.success('Ключ скопирован', task.key);
          }}
        >
          <Copy />
          Копировать ключ
        </DropdownMenuItem>

        {actions.canEdit && (
          <DropdownMenuItem onSelect={() => actions.duplicate(task)}>
            <CopyPlus />
            Дублировать
          </DropdownMenuItem>
        )}

        {actions.canArchive && !task.isArchived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => actions.archive(task)}>
              <Archive />В архив
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Конец рабочего дня через N суток.
 * 18:00 — потому что «сегодня» в задачах почти всегда означает
 * «до конца рабочего дня», а не «до полуночи».
 */
function endOfDay(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}
