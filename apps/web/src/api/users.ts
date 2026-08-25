import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, NotificationPreferences, PublicUser, SessionDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth';

export function useUsers(options: { search?: string; boardId?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.users(options),
    queryFn: () =>
      api
        .get<{ items: PublicUser[] }>('/api/users', { ...options, limit: 100 })
        .then((response) => response.items),
    staleTime: 120_000,
  });
}

export function useUpdateProfile() {
  const setUser = useAuthStore((state) => state.setUser);
  return useMutation({
    mutationFn: (input: {
      displayName?: string;
      avatarUrl?: string | null;
      timezone?: string;
      locale?: 'ru' | 'en';
    }) => api.patch<{ user: CurrentUser }>('/api/users/me', input).then((r) => r.user),
    onSuccess: (user) => setUser(user),
  });
}

export function useUploadAvatar() {
  const setUser = useAuthStore((state) => state.setUser);
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<{ avatarUrl: string; user: CurrentUser }>('/api/users/me/avatar', formData);
    },
    onSuccess: (result) => setUser(result.user),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () =>
      api
        .get<{ preferences: NotificationPreferences }>('/api/users/me/notifications-settings')
        .then((response) => response.preferences),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<NotificationPreferences>) =>
      api
        .patch<{ preferences: NotificationPreferences }>(
          '/api/users/me/notifications-settings',
          input,
        )
        .then((response) => response.preferences),
    onSuccess: (preferences) => {
      queryClient.setQueryData(['notification-preferences'], preferences);
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.get<{ items: SessionDto[] }>('/api/auth/sessions').then((r) => r.items),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(`/api/auth/sessions/${sessionId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}
