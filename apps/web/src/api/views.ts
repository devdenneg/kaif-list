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

/**
 * Ссылка на выгрузку CSV.
 *
 * Скачивание идёт обычным переходом по ссылке, а не через fetch:
 * так браузер сам показывает прогресс и кладёт файл в «Загрузки».
 * Токен доступа при этом не нужен — запрос уходит с cookie сессии,
 * поэтому ссылку открываем в новой вкладке через программный клик.
 */
export function buildExportUrl(boardId: string, filters: Record<string, unknown>): string {
  const url = new URL(`/api/boards/${boardId}/export.csv`, window.location.origin);
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) url.searchParams.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      if (value) url.searchParams.set(key, 'true');
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
