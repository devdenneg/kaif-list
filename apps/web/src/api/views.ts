import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSavedViewPayload, SavedViewDto } from '@kaif/shared';
import { api } from '@/lib/api';

/** Сохранённые наборы фильтров доски. */
export function useSavedViews(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board', boardId ?? '', 'views'],
    queryFn: () =>
      api
        .get<{ items: SavedViewDto[] }>(`/api/boards/${boardId}/views`)
        .then((response) => response.items),
    enabled: Boolean(boardId),
    staleTime: 120_000,
  });
}

export function useCreateSavedView(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedViewPayload) =>
      api
        .post<{ view: SavedViewDto }>(`/api/boards/${boardId}/views`, input)
        .then((response) => response.view),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', boardId, 'views'] });
    },
  });
}

export function useDeleteSavedView(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => api.delete(`/api/boards/${boardId}/views/${viewId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', boardId, 'views'] });
    },
  });
}
