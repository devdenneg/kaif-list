import * as React from 'react';
import type { BoardDto, ColumnKey, TaskCardDto, TaskPriority } from '@kaif/shared';
import { can } from '@kaif/shared';
import {
  useArchiveTaskById,
  useDuplicateTaskById,
  useMoveTask,
  useUpdateTaskById,
} from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { BoardFilters } from '@/stores/ui';
import { MoveReasonDialog, type ReasonRequest } from '@/features/task/move-reason-dialog';

/**
 * Быстрые действия над карточкой.
 *
 * Живут в контексте по двум причинам:
 *  1. окно «нужна причина» должно быть одно на доску, а не по одному на карточку;
 *  2. карточка не должна знать про мутации и права — она про отображение.
 *
 * Контекст необязателен: там, где провайдера нет (мои задачи, панель человека),
 * карточка просто не показывает меню.
 */

export interface TaskQuickActions {
  board: BoardDto;
  canEdit: boolean;
  canMove: boolean;
  canArchive: boolean;
  currentUserId: string | undefined;
  move: (task: TaskCardDto, column: ColumnKey) => void;
  assign: (task: TaskCardDto, userId: string | null) => void;
  takeInProgress: (task: TaskCardDto) => void;
  setPriority: (task: TaskCardDto, priority: TaskPriority) => void;
  setDueDate: (task: TaskCardDto, dueDate: string | null) => void;
  archive: (task: TaskCardDto) => void;
  duplicate: (task: TaskCardDto) => void;
  busy: boolean;
}

const TaskActionsContext = React.createContext<TaskQuickActions | null>(null);

export function useTaskActions(): TaskQuickActions | null {
  return React.useContext(TaskActionsContext);
}

export function TaskActionsProvider({
  board,
  filters,
  children,
}: {
  board: BoardDto;
  filters: BoardFilters;
  children: React.ReactNode;
}): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const moveTask = useMoveTask(board.id, filters);
  const updateTask = useUpdateTaskById(board.id);
  const archiveTask = useArchiveTaskById(board.id);
  const duplicateTask = useDuplicateTaskById(board.id);

  const [reasonRequest, setReasonRequest] = React.useState<ReasonRequest | null>(null);
  const pending = React.useRef<((reason: string) => void) | null>(null);

  const accessContext = user
    ? { globalRole: user.globalRole, boardRole: board.myRole, boardArchived: board.isArchived }
    : null;

  /** Общая обработка отказа: если нужна причина — спрашиваем и повторяем. */
  const handleError = React.useCallback(
    (error: unknown, retry: (reason: string) => void, fallback: string, request?: Partial<ReasonRequest>) => {
      if (error instanceof ApiError && error.needsReason && error.reasonRequired) {
        pending.current = retry;
        setReasonRequest({
          code: error.reasonRequired.code,
          message: error.reasonRequired.message,
          ...request,
        });
        return;
      }
      toast.error(fallback, error);
    },
    [],
  );

  const value = React.useMemo<TaskQuickActions>(() => {
    const move = (task: TaskCardDto, column: ColumnKey, reason?: string): void => {
      moveTask.mutate(
        { taskId: task.id, toColumn: column, ...(reason ? { reason } : {}) },
        {
          onSuccess: () => {
            setReasonRequest(null);
            pending.current = null;
          },
          onError: (error) =>
            handleError(
              error,
              (value2) => move(task, column, value2),
              'Не удалось переместить задачу',
              { fromColumn: task.columnKey, toColumn: column },
            ),
        },
      );
    };

    const patch = (
      task: TaskCardDto,
      input: Record<string, unknown>,
      fallback: string,
      reason?: string,
    ): void => {
      updateTask.mutate(
        { taskId: task.id, ...input, ...(reason ? { reason } : {}) },
        {
          onSuccess: () => {
            setReasonRequest(null);
            pending.current = null;
          },
          onError: (error) =>
            handleError(error, (value2) => patch(task, input, fallback, value2), fallback),
        },
      );
    };

    return {
      board,
      canEdit: accessContext ? can(accessContext, 'task.update') : false,
      canMove: accessContext ? can(accessContext, 'task.move') : false,
      canArchive: accessContext ? can(accessContext, 'task.archive') : false,
      currentUserId: user?.id,
      busy:
        moveTask.isPending ||
        updateTask.isPending ||
        archiveTask.isPending ||
        duplicateTask.isPending,

      move: (task, column) => move(task, column),

      assign: (task, userId) => patch(task, { assigneeId: userId }, 'Не удалось назначить'),

      /** Самое частое действие: взять задачу себе и сразу начать. */
      takeInProgress: (task) => {
        if (task.assignee?.id !== user?.id && user) {
          patch(task, { assigneeId: user.id }, 'Не удалось назначить');
        }
        if (task.columnKey !== 'IN_PROGRESS') move(task, 'IN_PROGRESS');
      },

      setPriority: (task, priority) =>
        patch(task, { priority }, 'Не удалось изменить приоритет'),

      setDueDate: (task, dueDate) => patch(task, { dueDate }, 'Не удалось изменить срок'),

      archive: (task) => {
        archiveTask.mutate(
          { taskId: task.id, archived: true },
          {
            onSuccess: () => {
              // Архивация обратима, поэтому предлагаем отменить прямо в тосте —
              // это дешевле, чем диалог подтверждения на каждое действие.
              toast.undo(`${task.key} в архиве`, () => {
                archiveTask.mutate({ taskId: task.id, archived: false });
              });
            },
            onError: (error) => toast.error('Не удалось архивировать', error),
          },
        );
      },

      duplicate: (task) => {
        duplicateTask.mutate(
          { taskId: task.id, count: 1 },
          {
            onSuccess: (created) => toast.success('Создана копия', created.key),
            onError: (error) => toast.error('Не удалось продублировать', error),
          },
        );
      },
    };
  }, [
    board,
    accessContext,
    user,
    moveTask,
    updateTask,
    archiveTask,
    duplicateTask,
    handleError,
  ]);

  return (
    <TaskActionsContext.Provider value={value}>
      {children}
      <MoveReasonDialog
        open={Boolean(reasonRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setReasonRequest(null);
            pending.current = null;
          }
        }}
        request={reasonRequest}
        loading={moveTask.isPending || updateTask.isPending}
        onSubmit={(reason) => pending.current?.(reason)}
      />
    </TaskActionsContext.Provider>
  );
}
