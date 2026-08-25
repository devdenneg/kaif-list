import { useMutation } from '@tanstack/react-query';
import type { BoardGroupDto, CreateBoardGroupPayload } from '@kaif/shared';
import { api } from '@/lib/api';
import { invalidateEntity } from '@/lib/query-client';

/**
 * Рабочие группы доски.
 *
 * Отдельного запроса за списком нет: группы приходят вместе с доской
 * (`useBoard`), потому что нужны сразу — и в фильтрах, и в настройках.
 * Мутации инвалидируют доску целиком.
 */
function useGroupMutation<TVariables, TResult>(
  boardId: string,
  request: (variables: TVariables) => Promise<TResult>,
) {
  return useMutation({
    mutationFn: request,
    onSuccess: () => invalidateEntity('board', boardId),
  });
}

export function useCreateGroup(boardId: string) {
  return useGroupMutation(boardId, (input: CreateBoardGroupPayload) =>
    api
      .post<{ group: BoardGroupDto }>(`/api/boards/${boardId}/groups`, input)
      .then((response) => response.group),
  );
}

export function useUpdateGroup(boardId: string) {
  return useGroupMutation(
    boardId,
    ({ groupId, ...input }: { groupId: string; name?: string; color?: string; order?: number }) =>
      api
        .patch<{ group: BoardGroupDto }>(`/api/boards/${boardId}/groups/${groupId}`, input)
        .then((response) => response.group),
  );
}

export function useSetGroupMembers(boardId: string) {
  return useGroupMutation(boardId, ({ groupId, userIds }: { groupId: string; userIds: string[] }) =>
    api
      .put<{ group: BoardGroupDto }>(`/api/boards/${boardId}/groups/${groupId}/members`, {
        userIds,
      })
      .then((response) => response.group),
  );
}

export function useDeleteGroup(boardId: string) {
  return useGroupMutation(boardId, (groupId: string) =>
    api.delete(`/api/boards/${boardId}/groups/${groupId}`),
  );
}
