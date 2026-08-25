import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, ReactionEmoji, RichTextDoc } from '@kaif/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useComments(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.taskComments(taskId ?? ''),
    queryFn: () =>
      api
        .get<{ items: CommentDto[]; nextCursor: string | null }>(`/api/tasks/${taskId}/comments`, {
          limit: 100,
          order: 'asc',
        })
        .then((response) => response.items),
    enabled: Boolean(taskId),
  });
}

export function useCreateComment(taskId: string, boardId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: RichTextDoc; parentId?: string | null; attachmentIds?: string[] }) =>
      api
        .post<{ comment: CommentDto }>(`/api/tasks/${taskId}/comments`, input)
        .then((response) => response.comment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      if (boardId) void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
    },
  });
}

export function useUpdateComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commentId: string; body: RichTextDoc }) =>
      api.patch(`/api/tasks/${taskId}/comments/${input.commentId}`, { body: input.body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
    },
  });
}

/**
 * Реакция на комментарий.
 *
 * Обновляем кеш сразу из ответа сервера, без инвалидации всего списка:
 * реакции ставят часто, и перезагружать из-за них всё обсуждение — расточительно.
 */
export function useToggleReaction(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commentId: string; emoji: ReactionEmoji }) =>
      api
        .post<{ comment: CommentDto }>(
          `/api/tasks/${taskId}/comments/${input.commentId}/reactions`,
          { emoji: input.emoji },
        )
        .then((response) => response.comment),
    onSuccess: (comment) => {
      queryClient.setQueryData<CommentDto[]>(queryKeys.taskComments(taskId), (current) =>
        current?.map((item) => (item.id === comment.id ? comment : item)),
      );
    },
  });
}

export function useDeleteComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/api/tasks/${taskId}/comments/${commentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    },
  });
}
