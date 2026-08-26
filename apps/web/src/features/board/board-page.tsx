import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  ChevronDown,
  Inbox,
  LayoutList,
  Plus,
  Settings,
  Star,
  Users,
  WifiOff,
} from 'lucide-react';
import { can, type BoardDto, type ColumnKey, type TaskCardDto } from '@kaif/shared';
import { useBoard, useToggleFavorite } from '@/api/boards';
import { useBoardTasks, useMoveTask, useTaskMovePending } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { useBoardFilters, useBoardSwimlane, useUiStore, type Swimlane } from '@/stores/ui';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FullScreenLoader } from '@/app/loader';
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

// Лимит меняется непрерывно вместе с высотой окна: шапка забирает только
// свободное место сверх полезной области доски. На телефоне учитываем верхнюю
// строку, нижнюю навигацию и вкладки колонок; на десктопе — верхнюю строку.
// Минимум в 3.5rem оставляет видимой строку с названием, а остальные элементы
// управления остаются доступны внутренней прокруткой.
const MOBILE_HEADER_MAX_HEIGHT =
  'clamp(3.5rem, calc(100dvh - 24rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)), 20rem)';
const DESKTOP_HEADER_MAX_HEIGHT =
  'clamp(3.5rem, calc(100dvh - 18.5rem - env(safe-area-inset-top)), 20rem)';

const SWIMLANE_LABELS: Record<Swimlane, string> = {
  none: 'Без дорожек',
  assignee: 'По исполнителю',
  priority: 'По приоритету',
  type: 'По типу',
};

function BoardNavigation({
  board,
  swimlane,
  canSeeAnalytics,
  canManageBoard,
  onChangeSwimlane,
  onOpenSettings,
  mobile = false,
}: {
  board: BoardDto;
  swimlane: Swimlane;
  canSeeAnalytics: boolean;
  canManageBoard: boolean;
  onChangeSwimlane: (value: Swimlane) => void;
  onOpenSettings: () => void;
  mobile?: boolean;
}): React.ReactElement {
  const actionClass = mobile
    ? 'relative h-14 min-w-0 flex-col gap-1 rounded-lg px-1 text-[10px] leading-none text-muted-foreground [&_svg]:!size-5'
    : 'h-8 rounded-lg px-2.5 text-xs text-muted-foreground [&_svg]:!size-4';

  return (
    <nav
      aria-label="Разделы и вид доски"
      className={cn(
        mobile
          ? 'mb-2 grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-border bg-secondary/35 p-1 md:hidden'
          : 'hidden min-h-11 snap-start items-center gap-1 border-t border-border/70 bg-secondary/10 px-3 py-1.5 sm:px-4 md:flex',
      )}
    >
      <Button variant="ghost" size="sm" asChild className={actionClass}>
        <Link to={`/boards/${board.key}/backlog`}>
          {mobile ? (
            <span className="relative flex">
              <Inbox />
              <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-secondary px-1 text-center text-[9px] leading-4 tabular-nums text-foreground">
                {board.counts.backlog > 99 ? '99+' : board.counts.backlog}
              </span>
            </span>
          ) : (
            <Inbox />
          )}
          <span className="max-w-full truncate">Бэклог</span>
          {!mobile && (
            <span className="min-w-5 rounded-full bg-secondary px-1.5 text-center text-[10px] leading-5 tabular-nums">
              {board.counts.backlog}
            </span>
          )}
        </Link>
      </Button>

      <Button variant="ghost" size="sm" asChild className={actionClass}>
        <Link to={`/boards/${board.key}/people`}>
          <Users />
          <span className="max-w-full truncate">Люди</span>
        </Link>
      </Button>

      {canSeeAnalytics && (
        <Button variant="ghost" size="sm" asChild className={actionClass}>
          <Link to={`/boards/${board.key}/dashboard`}>
            <BarChart3 />
            <span className="max-w-full truncate">Аналитика</span>
          </Link>
        </Button>
      )}

      {!mobile && <span className="ml-auto" aria-hidden />}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(actionClass, swimlane !== 'none' && 'bg-accent text-accent-foreground')}
            title={`Группировка: ${SWIMLANE_LABELS[swimlane]}`}
            aria-label={`Группировка: ${SWIMLANE_LABELS[swimlane]}`}
          >
            <LayoutList />
            <span className="max-w-full truncate">
              {mobile ? 'Дорожки' : SWIMLANE_LABELS[swimlane]}
            </span>
            {!mobile && <ChevronDown className="opacity-70" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="[&_svg]:!size-4">
          <DropdownMenuRadioGroup
            value={swimlane}
            onValueChange={(value) => onChangeSwimlane(value as Swimlane)}
          >
            <DropdownMenuRadioItem value="none">Без дорожек</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="assignee">По исполнителю</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="priority">По приоритету</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="type">По типу</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {canManageBoard && (
        <Button variant="ghost" size="sm" className={actionClass} onClick={onOpenSettings}>
          <Settings />
          <span className="max-w-full truncate">Настройки</span>
        </Button>
      )}
    </nav>
  );
}

export function BoardPage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const user = useAuthStore((state) => state.user);
  const setLastBoardId = useUiStore((state) => state.setLastBoardId);

  const { data: board, isLoading, error } = useBoard(boardKey);
  const swimlane = useBoardSwimlane(board?.id ?? '');
  const setSwimlane = useUiStore((state) => state.setSwimlane);
  const filters = useBoardFilters(board?.id ?? '');
  const {
    data: columns,
    isLoading: tasksLoading,
    isPlaceholderData: tasksArePlaceholder,
  } = useBoardTasks(board?.id, filters);
  const presence = useBoardRealtime(board?.id);
  const socketConnected = useSocketConnected();

  const moveTask = useMoveTask(board?.id ?? '', filters);
  const taskMovePending = useTaskMovePending(board?.id ?? '');
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
  const canSeeAnalytics = accessContext ? can(accessContext, 'board.analytics.view') : false;

  // Кнопка «Создать» в мобильной навигации ставит ?new=task —
  // так нижняя панель не обязана знать про диалоги конкретной страницы.
  // Право проверяем повторно: прямой URL не открывает недоступное действие.
  React.useEffect(() => {
    if (searchParams.get('new') !== 'task' || !board) return;
    if (canCreate) {
      setCreateTaskDefaults({});
      setCreateTaskOpen(true);
    }
    setSearchParams(
      (params) => {
        params.delete('new');
        return params;
      },
      { replace: true },
    );
  }, [board, canCreate, searchParams, setSearchParams]);

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
      if (taskMovePending) return;

      void moveTask
        .mutateAsync({
          taskId: request.taskId,
          toColumn: request.toColumn,
          beforeTaskId: request.beforeTaskId ?? null,
          afterTaskId: request.afterTaskId ?? null,
          ...(reason ? { reason } : {}),
        })
        .then(() => {
          setPendingMove(null);
          setReasonRequest(null);
        })
        .catch((error: unknown) => {
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
        });
    },
    [moveTask, taskMovePending],
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
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Шапка доски ── */}
      <div
        className="scrollbar-thin shrink-0 snap-y snap-proximity overflow-y-auto overscroll-y-contain border-b border-border bg-surface/85 backdrop-blur-sm"
        style={{ maxHeight: isMobile ? MOBILE_HEADER_MAX_HEIGHT : DESKTOP_HEADER_MAX_HEIGHT }}
      >
        <div className="flex min-h-12 snap-start items-center gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: board.color }}
              aria-hidden
            />
            <h1 className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">
              {board.name}
            </h1>
            <span className="hidden shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground xs:inline">
              {board.key}
            </span>
            {board.isArchived && (
              <span className="hidden shrink-0 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning md:inline">
                Архив — только чтение
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!socketConnected && (
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-xs font-medium text-warning md:h-8 md:w-auto md:px-2"
                title="Обновления приостановлены"
                aria-label="Обновления приостановлены"
              >
                <WifiOff className="size-4" aria-hidden />
                <span className="ml-1.5 hidden lg:inline">Нет обновлений</span>
              </span>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              className="size-10 shrink-0 text-muted-foreground md:size-8 [&_svg]:!size-4"
              onClick={() => toggleFavorite.mutate(!board.isFavorite)}
              aria-label={board.isFavorite ? 'Убрать из избранного' : 'В избранное'}
            >
              <Star className={cn(board.isFavorite && 'fill-warning text-warning')} />
            </Button>

            {/* Архив доступен всем: закрытые задачи должны быть под рукой,
                а не только у тех, кто может их вернуть. */}
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              className="size-10 shrink-0 text-muted-foreground md:size-8 [&_svg]:!size-4"
            >
              <Link to={`/boards/${board.key}/archive`} aria-label="Архив доски" title="Архив">
                <Archive />
              </Link>
            </Button>

            {canCreate && (
              <Button
                variant="primary"
                size="sm"
                className="hidden h-8 md:inline-flex [&_svg]:!size-4"
                onClick={() => {
                  setCreateTaskDefaults({});
                  setCreateTaskOpen(true);
                }}
              >
                <Plus />
                Задача
              </Button>
            )}
          </div>
        </div>

        <BoardNavigation
          board={board}
          swimlane={swimlane}
          canSeeAnalytics={canSeeAnalytics}
          canManageBoard={canManageBoard}
          onChangeSwimlane={(value) => setSwimlane(board.id, value)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="snap-start border-t border-border/70 px-3 py-2 sm:px-4">
          <BoardNavigation
            mobile
            board={board}
            swimlane={swimlane}
            canSeeAnalytics={canSeeAnalytics}
            canManageBoard={canManageBoard}
            onChangeSwimlane={(value) => setSwimlane(board.id, value)}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="min-w-0 lg:shrink-0 [&>div]:flex-nowrap [&>div>div:first-child]:min-w-0 [&>div>div:first-child]:w-auto [&>div>div:first-child]:flex-1 [&_input]:!h-9 [&_input]:min-w-0 [&_svg]:!size-4 lg:[&>div>div:first-child]:flex-none">
              <BoardFilters board={board} />
            </div>

            <span className="hidden h-6 w-px shrink-0 bg-border lg:block" aria-hidden />

            {/* Быстрый фильтр по исполнителю остаётся видимым и не сжимается действиями. */}
            <div className="min-w-0 flex-1">
              <PeopleBar
                board={board}
                presence={presence}
                canCreate={canCreate}
                canManage={canManageBoard}
                onCreateTaskFor={(assigneeId) => {
                  setCreateTaskDefaults({ assigneeId });
                  setCreateTaskOpen(true);
                }}
                {...(isMobile ? { compact: true } : {})}
              />
            </div>
          </div>

          <div className="mt-2 border-t border-border/70 pt-2">
            <BoardQuickFilters board={board} />
          </div>
        </div>
      </div>

      {/* ── Колонки ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2 sm:pt-3">
        {isMobile && columns && swimlane === 'none' && <MobileColumnTabs columns={columns} />}

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
                canDrag={canDrag && !taskMovePending && !tasksArePlaceholder}
                canCreate={canCreate}
                {...(user?.timezone ? { timeZone: user.timezone } : {})}
                {...(isMobile ? { mobile: true } : {})}
              />
            ) : (
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-4">
                <SwimlaneBoard
                  board={board}
                  columns={columns}
                  swimlane={swimlane}
                  onOpenTask={openTask}
                  onMove={(request) => performMove(request)}
                  canDrag={canDrag && !taskMovePending && !tasksArePlaceholder}
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
      {openTaskKey && <TaskDialog taskKey={openTaskKey} boardId={board.id} onClose={closeTask} />}

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
        loading={taskMovePending}
        onSubmit={(reason) => {
          if (pendingMove) performMove(pendingMove, reason);
        }}
      />
    </div>
  );
}
