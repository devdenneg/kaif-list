import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Настройки кеша подобраны под доску: данные живут недолго, но реалтайм
 * всё равно точечно инвалидирует нужные ключи, поэтому агрессивный refetch
 * при фокусе только мешал бы.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          // «Нет такого» и «нельзя» повторять бессмысленно.
          if (error.status === 404 || error.status === 403 || error.status === 422) return false;
          // Валидация тоже не изменится от повтора.
          if (error.status === 400) return false;
          // А вот истёкший токен, лимит частоты и обрыв связи — временные:
          // именно из-за них экран показывал «доска не найдена» на ровном месте.
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Инвалидация доски или задачи по любому из двух её имён.
 *
 * Экраны открываются по человекочитаемому ключу (`/boards/KAIF`,
 * `/tasks/KAIF-12`), поэтому в кеше запись лежит под ним. Мутации и
 * события сокета знают только идентификатор — и без этой сшивки
 * инвалидировали бы пустую запись, а на экране оставалось бы старое
 * значение до перезагрузки страницы.
 *
 * Второе имя ищем в самих данных кеша: там есть и `id`, и `key`.
 */
export function invalidateEntity(scope: 'board' | 'task', idOrKey: string): void {
  void queryClient.invalidateQueries({ queryKey: [scope, idOrKey] });

  for (const query of queryClient.getQueryCache().findAll({ queryKey: [scope] })) {
    const alias = query.queryKey[1];
    if (typeof alias !== 'string' || alias === idOrKey) continue;

    const data = query.state.data as { id?: string; key?: string } | undefined;
    if (!data || typeof data !== 'object') continue;
    if (data.id === idOrKey || data.key === idOrKey) {
      void queryClient.invalidateQueries({ queryKey: [scope, alias] });
    }
  }
}

/** Записать свежий объект под оба его имени — и по id, и по ключу. */
export function setEntityData<T extends { id: string; key: string }>(
  scope: 'board' | 'task',
  data: T,
): void {
  queryClient.setQueryData([scope, data.id], data);
  queryClient.setQueryData([scope, data.key], data);
}

/** Точечно поправить объект в кеше, не дожидаясь ответа сервера. */
export function updateEntityData<T extends { id: string; key: string }>(
  scope: 'board' | 'task',
  idOrKey: string,
  updater: (previous: T) => T,
): void {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [scope] })) {
    const data = query.state.data as T | undefined;
    if (!data || typeof data !== 'object') continue;
    if (data.id !== idOrKey && data.key !== idOrKey) continue;
    queryClient.setQueryData<T>(query.queryKey, (previous) =>
      previous ? updater(previous) : previous,
    );
  }
}

/**
 * Задача изменилась — а вместе с ней счётчики на карточках досок в сайдбаре
 * и экран «Мои задачи». Раньше они замирали до перезагрузки страницы.
 */
export function invalidateTaskScopes(boardId?: string): void {
  if (boardId) invalidateEntity('board', boardId);
  void queryClient.invalidateQueries({ queryKey: ['boards'] });
  void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
}

export const queryKeys = {
  boards: ['boards'] as const,
  board: (boardId: string) => ['board', boardId] as const,
  boardTasksRoot: (boardId: string) => ['board', boardId, 'tasks'] as const,
  boardTasks: (boardId: string, filters?: unknown) => ['board', boardId, 'tasks', filters] as const,
  boardTaskList: (boardId: string, filters?: unknown) =>
    ['board', boardId, 'task-list', filters] as const,
  boardWorkload: (boardId: string) => ['board', boardId, 'workload'] as const,
  boardActivity: (boardId: string) => ['board', boardId, 'activity'] as const,
  boardAnalytics: (boardId: string, days: number) => ['board', boardId, 'analytics', days] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskComments: (taskId: string) => ['task', taskId, 'comments'] as const,
  taskActivity: (taskId: string) => ['task', taskId, 'activity'] as const,
  taskMove: (boardId: string) => ['task-move', boardId] as const,
  notifications: (filters?: unknown) => ['notifications', filters] as const,
  notificationCount: ['notifications', 'count'] as const,
  users: (filters?: unknown) => ['users', filters] as const,
  myTasks: (scope: string) => ['my-tasks', scope] as const,
  sessions: ['sessions'] as const,
  search: (query: string) => ['search', query] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: (filters?: unknown) => ['admin', 'users', filters] as const,
  adminBoards: ['admin', 'boards'] as const,
  adminBacklog: (filters?: unknown) => ['admin', 'backlog', filters] as const,
  adminSecurity: ['admin', 'security'] as const,
};
