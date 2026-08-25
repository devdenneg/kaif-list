import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Inbox, Plus, Search, Send, UserPlus } from 'lucide-react';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_LABELS,
  TaskPriority,
  can,
  type ColumnKey,
  type TaskCardDto,
} from '@kaif/shared';
import { useBoard } from '@/api/boards';
import { useBulkTaskAction, useTaskList } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { EMPTY_FILTERS } from '@/stores/ui';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox, EmptyState, Skeleton } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserAvatar } from '@/components/ui/avatar';
import { FullScreenLoader } from '@/app/loader';
import { TaskCard } from '@/features/board/task-card';
import { TaskActionsProvider } from '@/features/board/task-actions-context';
import { CreateTaskDialog } from '@/features/task/create-task-dialog';
import { TaskDialog } from '@/features/task/task-dialog';

/**
 * Банк задач (бэклог).
 *
 * Здесь задачи копятся до того, как попадут на доску. Главный сценарий —
 * выделить несколько штук, назначить исполнителя и отправить в работу.
 */
export function BacklogPage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const user = useAuthStore((state) => state.user);
  const { data: board, isLoading } = useBoard(boardKey);

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [openTaskKey, setOpenTaskKey] = React.useState<string | null>(null);
  const [targetColumn, setTargetColumn] = React.useState<ColumnKey>('TODO');

  const { data: tasks, isLoading: tasksLoading } = useTaskList(board?.id, {
    ...EMPTY_FILTERS,
    search: debouncedSearch,
    onlyBacklog: true,
    sort: 'createdAt',
  });

  const bulkAction = useBulkTaskAction(board?.id ?? '');

  if (isLoading) return <FullScreenLoader inline />;
  if (!board) return <EmptyState title="Доска не найдена" />;

  const accessContext = user
    ? { globalRole: user.globalRole, boardRole: board.myRole, boardArchived: board.isArchived }
    : null;
  const canManage = accessContext ? can(accessContext, 'backlog.manage') : false;

  const toggle = (taskId: string): void => {
    setSelected((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  };

  const runBulk = (
    action: 'assign' | 'setPriority' | 'moveToBoard',
    payload: Record<string, unknown>,
  ): void => {
    bulkAction.mutate(
      { taskIds: selected, action, ...payload },
      {
        onSuccess: (result) => {
          toast.success(`Обновлено задач: ${result.affected}`);
          setSelected([]);
        },
        onError: (error) => toast.error('Не удалось выполнить действие', error),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-4">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={`/boards/${board.key}`}>
            <ArrowLeft />К доске
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Inbox className="size-5 text-muted-foreground" />
              Банк задач
            </h1>
            <p className="text-sm text-muted-foreground">
              {board.name} · {tasks?.length ?? 0} задач в бэклоге
            </p>
          </div>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по бэклогу"
            icon={<Search />}
            className="sm:w-64"
          />

          {canManage && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus />
              Задача
            </Button>
          )}
        </div>
      </header>

      {/* ── Панель массовых действий ── */}
      {selected.length > 0 && canManage && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-accent/60 px-3 py-2 shadow-card backdrop-blur">
          <span className="text-sm font-medium">Выбрано: {selected.length}</span>

          <Select onValueChange={(value) => runBulk('assign', { assigneeId: value })}>
            <SelectTrigger className="h-8 w-48">
              <UserPlus className="size-3.5" />
              <SelectValue placeholder="Назначить" />
            </SelectTrigger>
            <SelectContent>
              {board.members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  <span className="flex items-center gap-2">
                    <UserAvatar user={member.user} size="xs" />
                    {member.user.displayName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={(value) => runBulk('setPriority', { priority: value })}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              {Object.values(TaskPriority).map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Select value={targetColumn} onValueChange={(value) => setTargetColumn(value as ColumnKey)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_ORDER.map((column) => (
                  <SelectItem key={column} value={column}>
                    {COLUMN_LABELS[column]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="primary"
              loading={bulkAction.isPending}
              onClick={() => runBulk('moveToBoard', { columnKey: targetColumn })}
            >
              <Send />
              На доску
            </Button>
          </div>

          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Снять выделение
          </Button>
        </div>
      )}

      {tasksLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Бэклог пуст"
          description="Сюда складывают идеи и задачи, до которых руки дойдут позже."
          action={
            canManage && (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus />
                Добавить задачу
              </Button>
            )
          }
        />
      ) : (
        // Провайдеру фильтры нужны только для ключа кеша канбана —
        // в бэклоге канбана нет, поэтому передаём пустой набор.
        <TaskActionsProvider board={board} filters={EMPTY_FILTERS}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(tasks ?? []).map((task: TaskCardDto) => (
            <div key={task.id} className="relative">
              {canManage && (
                <label className="absolute -left-1 -top-1 z-10 cursor-pointer rounded bg-card p-1 shadow-card">
                  <Checkbox
                    checked={selected.includes(task.id)}
                    onCheckedChange={() => toggle(task.id)}
                    aria-label={`Выбрать ${task.key}`}
                  />
                </label>
              )}
              <TaskCard
                task={task}
                onOpen={() => setOpenTaskKey(task.key)}
                className={cn(selected.includes(task.id) && 'ring-2 ring-primary')}
                {...(user?.timezone ? { timeZone: user.timezone } : {})}
              />
            </div>
          ))}
          </div>
        </TaskActionsProvider>
      )}

      <CreateTaskDialog
        board={board}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaults={{ isBacklog: true }}
      />

      {openTaskKey && (
        <TaskDialog
          taskKey={openTaskKey}
          boardId={board.id}
          onClose={() => setOpenTaskKey(null)}
        />
      )}
    </div>
  );
}
