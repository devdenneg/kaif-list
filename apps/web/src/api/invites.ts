import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardInviteDto,
  BoardInvitePreviewDto,
  CreateBoardInvitePayload,
} from '@kaif/shared';
import { api } from '@/lib/api';

export function useBoardInvites(boardId: string, enabled = true) {
  return useQuery({
    queryKey: ['board-invites', boardId],
    queryFn: () =>
      api
        .get<{ items: BoardInviteDto[] }>(`/api/boards/${boardId}/invites`)
        .then((response) => response.items),
    enabled: enabled && Boolean(boardId),
    staleTime: 30_000,
  });
}

export function useCreateInvite(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInvitePayload) =>
      api
        .post<{ invite: BoardInviteDto }>(`/api/boards/${boardId}/invites`, input)
        .then((response) => response.invite),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board-invites', boardId] });
    },
  });
}

export function useRevokeInvite(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/api/boards/${boardId}/invites/${inviteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board-invites', boardId] });
    },
  });
}

export function useInvitePreview(token: string | undefined) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      api
        .get<{ invite: BoardInvitePreviewDto }>(`/api/invites/${token}`)
        .then((response) => response.invite),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<{ boardKey: string; boardId: string; alreadyMember: boolean }>(
        `/api/invites/${token}/accept`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}
