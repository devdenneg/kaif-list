import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
 * Перенос карточки с оптимистичным обновлением: доска реагирует мгновенно,
 * а при ошибке (например, сервер потребовал причину) состояние откатывается.
 */
export function useMoveTask(boardId: string, filters: BoardFilters) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.boardTasks(boardId, filtersToQuery(filters));

  return useMutation({
    mutationFn: ({ taskId, ...input }: MoveTaskVariables) =>
      api
        .post<{ task: TaskDetailDto }>(`/api/tasks/${taskId}/move`, input)
        .then((response) => response.task),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardColumns>(queryKey);
      if (!previous) return { previous };

      const next: BoardColumns = { ...previous };
      let moving: TaskCardDto | undefined;

      for (const column of COLUMN_ORDER) {
        const list = next[column] ?? [];
        const index = list.findIndex((task) => task.id === variables.taskId);
        if (index >= 0) {
          moving = list[index];
          next[column] = [...list.slice(0, index), ...list.slice(index + 1)];
          break;
        }
      }

      if (moving) {
        const target = [...(next[variables.toColumn] ?? [])];
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
        queryClient.setQueryData(queryKey, next);
      }

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: (task) => {
      invalidateTaskScopes(boardId);
      if (task) setEntityData('task', task);
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

export function useMyTasks(scope: 'active' | 'today' | 'overdue' | 'reported' | 'testing' | 'done') {
  return useQuery({
    queryKey: queryKeys.myTasks(scope),
    queryFn: () =>
      api
        .get<{ items: TaskCardDto[] }>('/api/users/me/tasks', { scope })
        .then((response) => response.items),
  });
}
