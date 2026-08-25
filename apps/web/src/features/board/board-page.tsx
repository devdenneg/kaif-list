import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Download,
  Inbox,
  LayoutList,
  MoreVertical,
  Plus,
  Settings,
  Star,
  Users,
  WifiOff,
} from 'lucide-react';
import { can, type ColumnKey, type TaskCardDto } from '@kaif/shared';
import { useBoard, useToggleFavorite } from '@/api/boards';
import { useBoardTasks, useMoveTask } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { useBoardFilters, useUiStore, type Swimlane } from '@/stores/ui';
import { useIsMobile } from '@/lib/hooks/use-media-query';
import { useHotkeys } from '@/lib/hooks/use-hotkeys';
import { useSocketConnected } from '@/lib/hooks/use-socket-status';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton, EmptyState } from '@/components/ui/misc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FullScreenLoader } from '@/app/loader';
import { buildExportUrl } from '@/api/views';
import { KanbanBoard, type MoveRequest } from './kanban-board';
import { SwimlaneBoard } from './swimlane-board';
import { TaskActionsProvider } from './task-actions-context';
import { BoardFilters } from './board-filters';
import { BoardQuickFilters } from './board-quick-filters';
import { PeopleBar } from './people-bar';
import { MobileColumnTabs } from './mobile-column-tabs';
import { BoardSettingsDialog } from './board-settings-dialog';
import { useBoardRealtime } from './use-board-realtime';
import { TaskDialog } from '@/features/task/task-dialog';
import { CreateTaskDialog } from '@/features/task/create-task-dialog';
import { MoveReasonDialog, type ReasonRequest } from '@/features/task/move-reason-dialog';

export function BoardPage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const user = useAuthStore((state) => state.user);
  const setLastBoardId = useUiStore((state) => state.setLastBoardId);
  const swimlane = useUiStore((state) => state.swimlane);
  const setSwimlane = useUiStore((state) => state.setSwimlane);

  const { data: board, isLoading, error } = useBoard(boardKey);
  const filters = useBoardFilters(board?.id ?? '');
  const { data: columns, isLoading: tasksLoading } = useBoardTasks(board?.id, filters);
  const presence = useBoardRealtime(board?.id);
  const socketConnected = useSocketConnected();

  const moveTask = useMoveTask(board?.id ?? '', filters);
  const toggleFavorite = useToggleFavorite(board?.id ?? '');

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);
  const [createTaskDefaults, setCreateTaskDefaults] = React.useState<{
    assigneeId?: string;
    columnKey?: ColumnKey;
  }>({});
  const [pendingMove, setPendingMove] = React.useState<MoveRequest | null>(null);
  const [reasonRequest, setReasonRequest] = React.useState<ReasonRequest | null>(null);

  React.useEffect(() => {
    if (board) setLastBoardId(board.id);
  }, [board, setLastBoardId]);

  const openTaskKey = searchParams.get('task');

  // Кнопка «Создать» в мобильной навигации ставит ?new=task —
  // так нижняя панель не обязана знать про диалоги конкретной страницы.
  React.useEffect(() => {
    if (searchParams.get('new') !== 'task') return;
    setCreateTaskDefaults({});
    setCreateTaskOpen(true);
    setSearchParams(
      (params) => {
        params.delete('new');
        return params;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const accessContext = React.useMemo(
    () =>
      board && user
        ? {
            globalRole: user.globalRole,
            boardRole: board.myRole,
            boardArchived: board.isArchived,
          }
        : null,
    [board, user],
  );

  const canCreate = accessContext ? can(accessContext, 'task.create') : false;
  const canDrag = accessContext ? can(accessContext, 'task.move') : false;
  const canManageBoard = accessContext ? can(accessContext, 'board.settings.manage') : false;

  useHotkeys(
    {
      c: () => {
        if (canCreate) {
          setCreateTaskDefaults({});
          setCreateTaskOpen(true);
        }
      },
    },
    Boolean(board),
  );

  const openTask = React.useCallback(
    (task: TaskCardDto) => {
      setSearchParams(
        (params) => {
          params.set('task', task.key);
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const closeTask = React.useCallback(() => {
    setSearchParams(
      (params) => {
        params.delete('task');
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /**
   * Перенос карточки. Если сервер требует объяснения (пауза, возврат назад),
   * показываем окно с причиной и повторяем запрос уже с ней.
   */
  const performMove = React.useCallback(
    (request: MoveRequest, reason?: string) => {
      moveTask.mutate(
        {
          taskId: request.taskId,
          toColumn: request.toColumn,
          beforeTaskId: request.beforeTaskId ?? null,
          afterTaskId: request.afterTaskId ?? null,
          ...(reason ? { reason } : {}),
        },
        {
          onSuccess: () => {
            setPendingMove(null);
            setReasonRequest(null);
          },
          onError: (error) => {
            if (error instanceof ApiError && error.needsReason && error.reasonRequired) {
              setPendingMove(request);
              setReasonRequest({
                code: error.reasonRequired.code,
                message: error.reasonRequired.message,
                toColumn: request.toColumn,
              });
              return;
            }
            toast.error('Не удалось переместить задачу', error);
          },
        },
      );
    },
    [moveTask],
  );

  if (isLoading) return <FullScreenLoader inline />;

  if (error || !board) {
    return (
      <div className="p-6">
        <EmptyState
          title="Доска не найдена"
          description="Возможно, её удалили или у вас больше нет доступа."
          action={
            <Button variant="primary" onClick={() => navigate('/boards')}>
              К списку досок
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ── Шапка доски ── */}
      <div className="shrink-0 border-b border-border bg-surface/60 px-3 pt-3 sm:px-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className="size-3 shrink-0 rounded"
            style={{ backgroundColor: board.color }}
            aria-hidden
          />
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{board.name}</h1>
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {board.key}
          </span>

          <button
            type="button"
            onClick={() => toggleFavorite.mutate(!board.isFavorite)}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
            aria-label={board.isFavorite ? 'Убрать из избранного' : 'В избранное'}
          >
            <Star className={cn('size-4', board.isFavorite && 'fill-warning text-warning')} />
          </button>

          {board.isArchived && (
            <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              Архив — только чтение
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {canCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCreateTaskDefaults({});
                  setCreateTaskOpen(true);
                }}
              >
                <Plus />
                <span className="hidden sm:inline">Задача</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Меню доски">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/boards/${board.key}/backlog`}>
                    <Inbox />
                    Бэклог ({board.counts.backlog})
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/boards/${board.key}/people`}>
                    <Users />
                    Люди
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/boards/${board.key}/dashboard`}>
                    <BarChart3 />
                    Аналитика
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  <span className="flex items-center gap-1.5">
                    <LayoutList className="size-3.5" />
                    Группировка
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={swimlane}
                  onValueChange={(value) => setSwimlane(value as Swimlane)}
                >
                  <DropdownMenuRadioItem value="none">Без дорожек</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="assignee">По исполнителю</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="priority">По приоритету</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="type">По типу</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    // Выгрузка идёт обычной ссылкой: браузер сам покажет прогресс
                    // и положит файл в «Загрузки».
                    window.location.href = buildExportUrl(board.id, {
                      search: filters.search,
                      assigneeIds: filters.assigneeIds,
                      groupIds: filters.groupIds,
                      labelIds: filters.labelIds,
                      priorities: filters.priorities,
                      types: filters.types,
                      due: filters.due !== 'any' ? filters.due : undefined,
                      unassigned: filters.unassigned,
                      includeArchived: filters.includeArchived,
                    });
                  }}
                >
                  <Download />
                  Выгрузить в CSV
                </DropdownMenuItem>

                {canManageBoard && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                      <Settings />
                      Настройки доски
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-2">
          <BoardFilters board={board} />
          <div className="ml-auto flex items-center gap-2">
            {!socketConnected && (
              <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                <WifiOff className="size-3.5" />
                Обновления приостановлены
              </span>
            )}
            {socketConnected && presence.length > 0 && (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                <Activity className="size-3.5 text-success" />
                сейчас на доске: {presence.length}
              </span>
            )}
          </div>
        </div>

        {/* ── Быстрая фильтрация по людям: слева направо, как в Jira ── */}
        <div className="pb-2">
          <PeopleBar
            board={board}
            presence={presence}
            canManage={canManageBoard}
            onCreateTaskFor={(assigneeId) => {
              setCreateTaskDefaults({ assigneeId });
              setCreateTaskOpen(true);
            }}
            {...(isMobile ? { compact: true } : {})}
          />
        </div>

        <div className="pb-3">
          <BoardQuickFilters board={board} />
        </div>
      </div>

      {/* ── Колонки ── */}
      <div className="min-h-0 flex-1 overflow-hidden pt-3">
        {isMobile && columns && <MobileColumnTabs columns={columns} />}

        {tasksLoading && !columns ? (
          <div className="flex gap-3 px-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-96 w-72 shrink-0 rounded-xl" />
            ))}
          </div>
        ) : columns ? (
          <TaskActionsProvider board={board} filters={filters}>
            {swimlane === 'none' ? (
              <KanbanBoard
                board={board}
                columns={columns}
                onOpenTask={openTask}
                onMove={(request) => performMove(request)}
                canDrag={canDrag}
                canCreate={canCreate}
                {...(user?.timezone ? { timeZone: user.timezone } : {})}
                {...(isMobile ? { mobile: true } : {})}
              />
            ) : (
              <div className="scrollbar-thin h-full overflow-y-auto pb-4">
                <SwimlaneBoard
                  board={board}
                  columns={columns}
                  swimlane={swimlane}
                  onOpenTask={openTask}
                  onMove={(request) => performMove(request)}
                  canDrag={canDrag}
                  canCreate={canCreate}
                  {...(user?.timezone ? { timeZone: user.timezone } : {})}
                  {...(isMobile ? { mobile: true } : {})}
                />
              </div>
            )}
          </TaskActionsProvider>
        ) : null}
      </div>

      {/* ── Диалоги ── */}
      {openTaskKey && (
        <TaskDialog taskKey={openTaskKey} boardId={board.id} onClose={closeTask} />
      )}

      <CreateTaskDialog
        board={board}
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        defaults={createTaskDefaults}
      />

      <BoardSettingsDialog board={board} open={settingsOpen} onOpenChange={setSettingsOpen} />

      <MoveReasonDialog
        open={Boolean(reasonRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setReasonRequest(null);
            setPendingMove(null);
          }
        }}
        request={reasonRequest}
        loading={moveTask.isPending}
        onSubmit={(reason) => {
          if (pendingMove) performMove(pendingMove, reason);
        }}
      />
    </div>
  );
}
