import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Search } from 'lucide-react';
import { can, type TaskCardDto } from '@kaif/shared';
import { useBoard } from '@/api/boards';
import { useArchiveTaskById, useArchivedTasks } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { toast } from '@/lib/toast';
import { formatDate, formatRelative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { BoardGate } from '@/features/board/board-gate';
import { PriorityIcon, TaskTypeIcon } from '@/features/task/task-visuals';
import { TaskDialog } from '@/features/task/task-dialog';

/**
 * Архив доски.
 *
 * Сюда сами уезжают задачи, пролежавшие в «Готово» дольше положенного.
 * Их быстро набирается много, поэтому это не колонка и не сетка карточек,
 * а плотный список: строка на задачу, группировка по дате архивации
 * и поиск. За один экран видно два десятка задач, а не четыре.
 */
export function ArchivePage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const user = useAuthStore((state) => state.user);
  const { data: board, isLoading, error, refetch } = useBoard(boardKey);

  const [search, setSearch] = React.useState('');
  const debounced = useDebounce(search, 300);
  const [openTaskKey, setOpenTaskKey] = React.useState<string | null>(null);

  const {
    data,
    isLoading: tasksLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useArchivedTasks(board?.id, debounced);
  const restore = useArchiveTaskById(board?.id ?? '');

  if (isLoading || !board) {
    return <BoardGate loading={isLoading} error={error} onRetry={() => void refetch()} />;
  }

  const accessContext = user
    ? { globalRole: user.globalRole, boardRole: board.myRole, boardArchived: board.isArchived }
    : null;
  const canRestore = accessContext ? can(accessContext, 'task.archive') : false;

  const tasks = (data?.pages ?? []).flatMap((page) => page.items);
  const groups = groupByArchivedAt(tasks);
  const autoDays = board.settings.autoArchiveDoneDays;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-4">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={`/boards/${board.key}`}>
            <ArrowLeft />К доске
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Archive className="size-5 text-muted-foreground" />
              Архив
            </h1>
            <p className="text-sm text-muted-foreground">
              {board.name}
              {autoDays > 0
                ? ` · задачи уезжают сюда через ${autoDays} ${dayWord(autoDays)} после «Готово»`
                : ' · автоматическая уборка выключена'}
            </p>
          </div>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по архиву"
            icon={<Search />}
            className="sm:w-64"
          />
        </div>
      </header>

      {tasksLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-11 rounded-lg" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<Archive />}
          title={debounced.trim() ? 'Ничего не нашли' : 'Архив пуст'}
          description={
            debounced.trim()
              ? 'Попробуйте другой запрос.'
              : autoDays > 0
                ? `Закрытые задачи попадут сюда через ${autoDays} ${dayWord(autoDays)} после того, как окажутся в «Готово».`
                : 'Здесь появятся задачи, убранные с доски.'
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
                <span className="ml-1.5 font-normal opacity-60">{group.tasks.length}</span>
              </h2>

              <ul className="overflow-hidden rounded-lg border border-border">
                {group.tasks.map((task) => (
                  <ArchiveRow
                    key={task.id}
                    task={task}
                    canRestore={canRestore}
                    onOpen={() => setOpenTaskKey(task.key)}
                    onRestore={() =>
                      restore.mutate(
                        { taskId: task.id, archived: false },
                        {
                          onSuccess: () => toast.success(`${task.key} вернулась на доску`),
                          onError: (error) => toast.error('Не удалось вернуть', error),
                        },
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          ))}

          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Показать ещё
              </Button>
            </div>
          )}
        </div>
      )}

      {openTaskKey && (
        <TaskDialog taskKey={openTaskKey} boardId={board.id} onClose={() => setOpenTaskKey(null)} />
      )}
    </div>
  );
}

function ArchiveRow({
  task,
  canRestore,
  onOpen,
  onRestore,
}: {
  task: TaskCardDto;
  canRestore: boolean;
  onOpen: () => void;
  onRestore: () => void;
}): React.ReactElement {
  return (
    <li className="group flex items-center gap-2 border-b border-border bg-card px-2.5 py-2 text-sm last:border-0 hover:bg-secondary/40">
      <TaskTypeIcon type={task.type} className="size-3.5 shrink-0" />
      <PriorityIcon priority={task.priority} className="size-3.5 shrink-0" />

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{task.key}</span>
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
      </button>

      {task.labels.slice(0, 2).map((label) => (
        <span
          key={label.id}
          className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline"
          style={{ backgroundColor: `${label.color}22`, color: label.color }}
        >
          {label.name}
        </span>
      ))}

      {task.assignee ? (
        <Tooltip content={task.assignee.displayName}>
          <span className="shrink-0">
            <UserAvatar user={task.assignee} size="xs" />
          </span>
        </Tooltip>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <Tooltip content={task.archivedAt ? formatDate(task.archivedAt) : ''}>
        <span className="hidden w-24 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
          {task.archivedAt ? formatRelative(task.archivedAt) : ''}
        </span>
      </Tooltip>

      {canRestore && (
        <Tooltip content="Вернуть на доску">
          <button
            type="button"
            onClick={onRestore}
            aria-label={`Вернуть ${task.key} на доску`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <ArchiveRestore className="size-3.5" />
          </button>
        </Tooltip>
      )}
    </li>
  );
}

/**
 * Группировка по дате архивации.
 *
 * Свежее — крупными шагами («сегодня», «вчера»), старое — по месяцам:
 * в архиве годовой давности день недели уже никому не интересен.
 */
function groupByArchivedAt(tasks: TaskCardDto[]): { label: string; tasks: TaskCardDto[] }[] {
  const groups = new Map<string, TaskCardDto[]>();

  for (const task of tasks) {
    const label = groupLabel(task.archivedAt);
    const list = groups.get(label) ?? [];
    list.push(task);
    groups.set(label, list);
  }

  return [...groups.entries()].map(([label, list]) => ({ label, tasks: list }));
}

const MONTHS = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
];

function groupLabel(archivedAt: string | null): string {
  if (!archivedAt) return 'Без даты';

  const date = new Date(archivedAt);
  const now = new Date();
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  if (days < 7) return 'На этой неделе';
  if (days < 30) return 'В этом месяце';

  const month = MONTHS[date.getMonth()] ?? '';
  return date.getFullYear() === now.getFullYear()
    ? `В ${month}`
    : `В ${month} ${date.getFullYear()}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayWord(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  const mod10 = count % 10;
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}
