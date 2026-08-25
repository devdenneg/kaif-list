import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useNotifications(onlyUnread = false) {
  return useQuery({
    queryKey: queryKeys.notifications({ onlyUnread }),
    queryFn: () =>
      api
        .get<{ items: NotificationDto[]; nextCursor: string | null }>('/api/notifications', {
          onlyUnread,
          limit: 50,
        })
        .then((response) => response.items),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notificationCount,
    queryFn: () =>
      api.get<{ unread: number }>('/api/notifications/unread-count').then((r) => r.unread),
    staleTime: 15_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: string[]; boardId?: string }) =>
      api.post<{ unread: number }>('/api/notifications/read', input),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.notificationCount, result.unread);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
