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
        // Ошибки прав и валидации повторять бессмысленно.
        if (error instanceof ApiError) {
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  boards: ['boards'] as const,
  board: (boardId: string) => ['board', boardId] as const,
  boardTasks: (boardId: string, filters?: unknown) => ['board', boardId, 'tasks', filters] as const,
  boardTaskList: (boardId: string, filters?: unknown) =>
    ['board', boardId, 'task-list', filters] as const,
  boardWorkload: (boardId: string) => ['board', boardId, 'workload'] as const,
  boardActivity: (boardId: string) => ['board', boardId, 'activity'] as const,
  boardAnalytics: (boardId: string, days: number) =>
    ['board', boardId, 'analytics', days] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskComments: (taskId: string) => ['task', taskId, 'comments'] as const,
  taskActivity: (taskId: string) => ['task', taskId, 'activity'] as const,
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
