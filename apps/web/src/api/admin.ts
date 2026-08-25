import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GlobalRole, PublicUser, TaskCardDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export interface AdminStats {
  users: number;
  activeUsers: number;
  boards: number;
  tasks: number;
  overdue: number;
  backlog: number;
  doneWeek: number;
  createdWeek: number;
  linkedBots: number;
}

export interface AdminUser extends PublicUser {
  globalRole: GlobalRole;
  profileCompleted: boolean;
  botLinked: boolean;
  botBlocked: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  assignedTasks: number;
  boards: number;
}

export interface AdminBoard {
  id: string;
  key: string;
  name: string;
  color: string;
  isArchived: boolean;
  createdAt: string;
  owner: PublicUser;
  members: number;
  tasks: number;
}

export interface SecurityEventDto {
  id: string;
  type: string;
  ip: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  user: PublicUser | null;
}

export function useAdminStats() {
  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: () => api.get<{ stats: AdminStats }>('/api/admin/stats').then((r) => r.stats),
  });
}

export function useAdminUsers(search: string) {
  return useQuery({
    queryKey: queryKeys.adminUsers({ search }),
    queryFn: () =>
      api
        .get<{ items: AdminUser[] }>('/api/admin/users', {
          search: search || undefined,
          includeInactive: true,
          limit: 200,
        })
        .then((response) => response.items),
  });
}

export function useAdminBoards() {
  return useQuery({
    queryKey: queryKeys.adminBoards,
    queryFn: () => api.get<{ items: AdminBoard[] }>('/api/admin/boards').then((r) => r.items),
  });
}

export function useGlobalBacklog(search: string) {
  return useQuery({
    queryKey: queryKeys.adminBacklog({ search }),
    queryFn: () =>
      api
        .get<{ items: TaskCardDto[] }>('/api/admin/backlog', {
          search: search || undefined,
          limit: 100,
        })
        .then((response) => response.items),
  });
}

export function useSecurityEvents() {
  return useQuery({
    queryKey: queryKeys.adminSecurity,
    queryFn: () =>
      api
        .get<{ items: SecurityEventDto[] }>('/api/admin/security-events', { limit: 100 })
        .then((response) => response.items),
  });
}

export function useSetUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: GlobalRole }) =>
      api.patch(`/api/admin/users/${input.userId}/role`, { role: input.role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useSetUserActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; isActive: boolean; reassignToUserId?: string | null }) => {
      const { userId, ...rest } = input;
      return api.patch(`/api/admin/users/${userId}/active`, rest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
