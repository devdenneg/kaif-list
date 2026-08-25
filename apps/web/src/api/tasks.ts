import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkTaskActionPayload,
  ColumnKey,
  CreateTaskPayload,
  DuplicateTaskPayload,
  MoveTaskInput,
  TaskCardDto,
  TaskDetailDto,
  TaskLinkDto,
  TaskLinkType,
  UpdateTaskPayload,
  ActivityDto,
} from '@kaif/shared';
import { COLUMN_ORDER } from '@kaif/shared';
import { api } from '@/lib/api';
import {
  invalidateEntity,
  invalidateTaskScopes,
  queryKeys,
  setEntityData,
} from '@/lib/query-client';
import type { BoardFilters } from '@/stores/ui';

export type BoardColumns = Record<ColumnKey, TaskCardDto[]>;

// Цепочка нужна только на время жизни объектов оптимистического обновления. WeakMap/WeakSet не
// удерживают старые кеши в памяти и позволяют корректно откатить две ошибки
// подряд, не возвращая уже отклонённое более раннее перемещение.
const optimisticMovePrevious = new WeakMap<BoardColumns, BoardColumns>();
const failedOptimisticMoves = new WeakSet<BoardColumns>();

function filtersToQuery(filters: BoardFilters): Record<string, unknown> {
  return {
    search: filters.search.trim() || undefined,
    assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
    groupIds: filters.groupIds.length > 0 ? filters.groupIds : undefined,
    labelIds: filters.labelIds.length > 0 ? filters.labelIds : undefined,
    priorities: filters.priorities.length > 0 ? filters.priorities : undefined,
    types: filters.types.length > 0 ? filters.types : undefined,
    due: filters.due !== 'any' ? filters.due : undefined,
    unassigned: filters.unassigned ? true : undefined,
    includeArchived: filters.includeArchived ? true : undefined,
  };
}

/** Канбан: задачи, сгруппированные по колонкам. */
export function useBoardTasks(boardId: string | undefined, filters: BoardFilters) {
  const query = filtersToQuery(filters);
  return useQuery({
    queryKey: queryKeys.boardTasks(boardId ?? '', query),
    queryFn: () =>
      api
        .get<{ columns: BoardColumns }>(`/api/boards/${boardId}/tasks`, query)
        .then((response) => response.columns),
    enabled: Boolean(boardId),
    placeholderData: (previous) => previous,
  });
}

/** Плоский список: бэклог, таблицы, поиск. */
export function useTaskList(
  boardId: string | undefined,
  filters: BoardFilters & { onlyBacklog?: boolean; sort?: string },
) {
  const query = {
    ...filtersToQuery(filters),
    onlyBacklog: filters.onlyBacklog ? true : undefined,
    sort: filters.sort,
    limit: 100,
  };
  return useQuery({
    queryKey: queryKeys.boardTaskList(boardId ?? '', query),
    queryFn: () =>
      api
        .get<{ items: TaskCardDto[]; nextCursor: string | null }>(
          `/api/boards/${boardId}/tasks/list`,
          query,
        )
        .then((response) => response.items),
    enabled: Boolean(boardId),
    placeholderData: (previous) => previous,
  });
}

export function useTask(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () =>
      api.get<{ task: TaskDetailDto }>(`/api/tasks/${taskId}`).then((response) => response.task),
    enabled: Boolean(taskId),
  });
}

export function useCreateTask(boardId: string) {
  return useMutation({
    mutationFn: (input: CreateTaskPayload) =>
      api
        .post<{ task: TaskDetailDto }>(`/api/boards/${boardId}/tasks`, input)
        .then((response) => response.task),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

export function useUpdateTask(taskId: string, boardId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskPayload) =>
      api
        .patch<{ task: TaskDetailDto }>(`/api/tasks/${taskId}`, input)
        .then((response) => response.task),
    onSuccess: (task) => {
      setEntityData('task', task);
      invalidateTaskScopes(boardId ?? task.boardId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) });
    },
  });
}

export interface MoveTaskVariables extends MoveTaskInput {
  taskId: string;
}

/**
 * Чистая перестановка карточки для мгновенного обновления интерфейса.
 *
 * Функция возвращает прежнюю ссылку, если задача отсутствует: так кеши других
 * наборов фильтров не получают карточку, которой в них раньше не было.
 */
export function applyOptimisticTaskMove(
  columns: BoardColumns,
  variables: MoveTaskVariables,
): BoardColumns {
  let moving: TaskCardDto | undefined;
  let sourceColumn: ColumnKey | undefined;

  for (const column of COLUMN_ORDER) {
    const task = columns[column]?.find((item) => item.id === variables.taskId);
    if (task) {
      moving = task;
      sourceColumn = column;
      break;
    }
  }

  if (!moving || !sourceColumn) return columns;

  const next: BoardColumns = { ...columns };
  next[sourceColumn] = (columns[sourceColumn] ?? []).filter((task) => task.id !== variables.taskId);

  const target =
    sourceColumn === variables.toColumn
      ? [...next[variables.toColumn]]
      : [...(columns[variables.toColumn] ?? [])];
  const updated: TaskCardDto = { ...moving, columnKey: variables.toColumn };
  const beforeIndex = variables.beforeTaskId
    ? target.findIndex((task) => task.id === variables.beforeTaskId)
    : -1;
  const afterIndex = variables.afterTaskId
    ? target.findIndex((task) => task.id === variables.afterTaskId)
    : -1;

  if (beforeIndex >= 0) target.splice(beforeIndex, 0, updated);
  else if (afterIndex >= 0) target.splice(afterIndex + 1, 0, updated);
  else target.push(updated);

  next[variables.toColumn] = target;
  return next;
}

/** Есть ли на доске ещё не подтверждённое сервером перемещение. */
export function useTaskMovePending(boardId: string): boolean {
  return useIsMutating({ mutationKey: queryKeys.taskMove(boardId) }) > 0;
}

/**
 * Перенос карточки с оптимистичным обновлением: доска реагирует мгновенно,
 * а при ошибке (например, сервер потребовал причину) состояние откатывается.
 */
export function useMoveTask(boardId: string, filters: BoardFilters) {
  const queryClient = useQueryClient();
  const visibleQueryKey = queryKeys.boardTasks(boardId, filtersToQuery(filters));
  const tasksRootKey = queryKeys.boardTasksRoot(boardId);
  const mutationKey = queryKeys.taskMove(boardId);

  return useMutation({
    mutationKey,
    // Ранги зависят от соседей, поэтому сервер обрабатывает перемещения доски
    // по порядку. В интерфейсе они всё равно применяются сразу через onMutate.
    scope: { id: `task-move:${boardId}` },
    mutationFn: ({ taskId, ...input }: MoveTaskVariables) =>
      api
        .post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/move`, input)
        .then((response) => response.task),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: tasksRootKey });

      const snapshots = queryClient
        .getQueriesData<BoardColumns>({ queryKey: tasksRootKey })
        .flatMap(([queryKey, previous]) => {
          if (!previous) return [];
          const optimistic = applyOptimisticTaskMove(previous, variables);
          if (optimistic === previous) return [];
          const storedOptimistic = queryClient.setQueryData<BoardColumns>(queryKey, optimistic);
          const stored = storedOptimistic ?? optimistic;
          optimisticMovePrevious.set(stored, previous);
          return [{ queryKey, previous, optimistic: stored }];
        });

      // При редком холодном кеше всё равно обновляем текущий ключ после того,
      // как данные в нём появятся; обычно он уже входит в snapshots.
      if (snapshots.length === 0) {
        const previous = queryClient.getQueryData<BoardColumns>(visibleQueryKey);
        if (previous) {
          const optimistic = applyOptimisticTaskMove(previous, variables);
          if (optimistic !== previous) {
            const storedOptimistic = queryClient.setQueryData<BoardColumns>(
              visibleQueryKey,
              optimistic,
            );
            snapshots.push({
              queryKey: visibleQueryKey,
              previous,
              optimistic: storedOptimistic ?? optimistic,
            });
            optimisticMovePrevious.set(storedOptimistic ?? optimistic, previous);
          }
        }
      }

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        failedOptimisticMoves.add(snapshot.optimistic);
        let rollback = snapshot.previous;

        // Если предыдущий слой тоже уже завершился ошибкой, откатываемся
        // дальше по цепочке, пока не дойдём до подтверждённого состояния.
        while (failedOptimisticMoves.has(rollback)) {
          const earlier = optimisticMovePrevious.get(rollback);
          if (!earlier || earlier === rollback) break;
          rollback = earlier;
        }

        // Не стираем более свежее перемещение, событие реального времени
        // или повторную загрузку данных.
        queryClient.setQueryData<BoardColumns>(snapshot.queryKey, (current) =>
          current === snapshot.optimistic ? rollback : current,
        );
      }
    },

    onSuccess: (task, variables) => {
      setEntityData('task', task);
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(task.id) });
      if (variables.reason) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(task.id) });
      }
    },

    onSettled: () => {
      // Не даём ответу раннего запроса перетереть следующее мгновенное перемещение.
      if (queryClient.isMutating({ mutationKey }) <= 1) invalidateTaskScopes(boardId);
    },
  });
}

export function useArchiveTask(taskId: string, boardId: string) {
  return useMutation({
    mutationFn: (input: { archived: boolean; reason?: string }) =>
      api.post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/archive`, input),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
      invalidateEntity('task', taskId);
    },
  });
}

export function useDeleteTask(taskId: string, boardId: string) {
  return useMutation({
    mutationFn: (confirm: string) => api.delete(`/api/tasks/${taskId}`, { confirm }),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

/**
 * Обновление произвольной задачи доски.
 *
 * В отличие от `useUpdateTask`, id задачи передаётся в вызове, а не в хуке:
 * это нужно быстрым действиям из меню карточки, где задача заранее неизвестна.
 */
export function useUpdateTaskById(boardId: string) {
  return useMutation({
    mutationFn: ({ taskId, ...input }: UpdateTaskPayload & { taskId: string }) =>
      api
        .patch<{ task: TaskDetailDto }>(`/api/tasks/${taskId}`, input)
        .then((response) => response.task),
    onSuccess: (task) => {
      setEntityData('task', task);
      invalidateTaskScopes(boardId);
    },
  });
}

export function useArchiveTaskById(boardId: string) {
  return useMutation({
    mutationFn: (input: { taskId: string; archived: boolean; reason?: string }) => {
      const { taskId, ...rest } = input;
      return api.post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/archive`, rest);
    },
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

export function useDuplicateTaskById(boardId: string) {
  return useMutation({
    mutationFn: ({ taskId, ...input }: DuplicateTaskPayload & { taskId: string }) =>
      api
        .post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/duplicate`, input)
        .then((response) => response.task),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

export function useDuplicateTask(taskId: string, boardId: string) {
  return useMutation({
    mutationFn: (input: DuplicateTaskPayload) =>
      api
        .post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/duplicate`, input)
        .then((response) => response.task),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

export function useWatchTask(taskId: string) {
  return useMutation({
    mutationFn: (watch: boolean) => api.post(`/api/tasks/${taskId}/watch`, { watch }),
    onSuccess: () => {
      invalidateEntity('task', taskId);
    },
  });
}

// ──────────────────────────────── Чек-листы ─────────────────────────────────

export function useChecklistMutations(taskId: string, boardId?: string) {
  const invalidate = (): void => {
    invalidateEntity('task', taskId);
    if (boardId) invalidateTaskScopes(boardId);
  };

  const createChecklist = useMutation({
    mutationFn: (title: string) => api.post(`/api/tasks/${taskId}/checklists`, { title }),
    onSuccess: invalidate,
  });

  const deleteChecklist = useMutation({
    mutationFn: (checklistId: string) =>
      api.delete(`/api/tasks/${taskId}/checklists/${checklistId}`),
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: (input: { checklistId: string; text: string }) =>
      api.post(`/api/tasks/${taskId}/checklists/${input.checklistId}/items`, { text: input.text }),
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: (input: { itemId: string; text?: string; done?: boolean }) => {
      const { itemId, ...rest } = input;
      return api.patch(`/api/tasks/${taskId}/checklist-items/${itemId}`, rest);
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/api/tasks/${taskId}/checklist-items/${itemId}`),
    onSuccess: invalidate,
  });

  return { createChecklist, deleteChecklist, addItem, updateItem, deleteItem };
}

// ────────────────────────────────── Связи ───────────────────────────────────

export function useTaskLinks(taskId: string, boardId?: string) {
  const invalidate = (): void => {
    invalidateEntity('task', taskId);
    if (boardId) invalidateTaskScopes(boardId);
  };

  const createLink = useMutation({
    mutationFn: (input: { type: TaskLinkType; targetTaskKey: string }) =>
      api
        .post<{ link: TaskLinkDto }>(`/api/tasks/${taskId}/links`, input)
        .then((response) => response.link),
    onSuccess: invalidate,
  });

  const deleteLink = useMutation({
    mutationFn: (linkId: string) => api.delete(`/api/tasks/${taskId}/links/${linkId}`),
    onSuccess: invalidate,
  });

  return { createLink, deleteLink };
}

// ──────────────────────────── История и массовые ────────────────────────────

export function useTaskActivity(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.taskActivity(taskId ?? ''),
    queryFn: () =>
      api
        .get<{ items: ActivityDto[] }>(`/api/tasks/${taskId}/activity`, { limit: 100 })
        .then((response) => response.items),
    enabled: Boolean(taskId),
  });
}

export function useBulkTaskAction(boardId: string) {
  return useMutation({
    mutationFn: (input: BulkTaskActionPayload) =>
      api.post<{ affected: number }>(`/api/boards/${boardId}/tasks/bulk`, input),
    onSuccess: () => {
      invalidateTaskScopes(boardId);
    },
  });
}

export function useMyTasks(
  scope: 'active' | 'today' | 'overdue' | 'reported' | 'testing' | 'done',
) {
  return useQuery({
    queryKey: queryKeys.myTasks(scope),
    queryFn: () =>
      api
        .get<{ items: TaskCardDto[] }>('/api/users/me/tasks', { scope })
        .then((response) => response.items),
  });
}
