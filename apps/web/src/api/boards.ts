import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardAnalyticsDto,
  BoardDto,
  BoardMemberDto,
  BoardRole,
  BoardSummaryDto,
  ColumnKey,
  CreateBoardInput,
  LabelDto,
  MemberWorkloadDto,
  UpdateBoardInput,
  ActivityDto,
} from '@kaif/shared';
import { api } from '@/lib/api';
import { invalidateEntity, queryKeys, setEntityData } from '@/lib/query-client';

export function useBoards(includeArchived = false) {
  return useQuery({
    queryKey: [...queryKeys.boards, includeArchived],
    queryFn: () =>
      api
        .get<{ items: BoardSummaryDto[] }>('/api/boards', { includeArchived })
        .then((response) => response.items),
  });
}

export function useBoard(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.board(boardId ?? ''),
    queryFn: () =>
      api.get<{ board: BoardDto }>(`/api/boards/${boardId}`).then((response) => response.board),
    enabled: Boolean(boardId),
  });
}

export function useCreateBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInput) =>
      api.post<{ board: BoardDto }>('/api/boards', input).then((response) => response.board),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
    },
  });
}

export function useUpdateBoard(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBoardInput) =>
      api
        .patch<{ board: BoardDto }>(`/api/boards/${boardId}`, input)
        .then((response) => response.board),
    onSuccess: (board) => {
      setEntityData('board', board);
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
    },
  });
}

export function useArchiveBoard(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      api.post<{ board: BoardDto }>(`/api/boards/${boardId}/archive`, { archived }),
    onSuccess: () => {
      invalidateEntity('board', boardId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
    },
  });
}

export function useDeleteBoard(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) => api.delete(`/api/boards/${boardId}`, { confirm }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
    },
  });
}

export function useTransferOwnership(boardId: string) {
  return useMutation({
    mutationFn: (input: { newOwnerId: string; confirm: string }) =>
      api.post(`/api/boards/${boardId}/transfer-ownership`, input),
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

export function useToggleFavorite(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (favorite: boolean) => api.post(`/api/boards/${boardId}/favorite`, { favorite }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards });
      invalidateEntity('board', boardId);
    },
  });
}

// ──────────────────────────────── Участники ─────────────────────────────────

export function useBoardWorkload(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boardWorkload(boardId ?? ''),
    queryFn: () =>
      api
        .get<{ items: MemberWorkloadDto[] }>(`/api/boards/${boardId}/workload`)
        .then((response) => response.items),
    enabled: Boolean(boardId),
    staleTime: 60_000,
  });
}

export function useAddBoardMember(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: BoardRole }) =>
      api
        .post<{ member: BoardMemberDto }>(`/api/boards/${boardId}/members`, input)
        .then((response) => response.member),
    onSuccess: () => {
      invalidateEntity('board', boardId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.boardWorkload(boardId) });
    },
  });
}

export function useChangeMemberRole(boardId: string) {
  return useMutation({
    mutationFn: (input: { userId: string; role: BoardRole }) =>
      api.patch(`/api/boards/${boardId}/members/${input.userId}`, { role: input.role }),
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

export function useRemoveMember(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/api/boards/${boardId}/members/${userId}`),
    onSuccess: () => {
      invalidateEntity('board', boardId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.boardWorkload(boardId) });
    },
  });
}

// ────────────────────────────── Метки и колонки ─────────────────────────────

export function useCreateLabel(boardId: string) {
  return useMutation({
    mutationFn: (input: { name: string; color: string; description?: string }) =>
      api
        .post<{ label: LabelDto }>(`/api/boards/${boardId}/labels`, input)
        .then((response) => response.label),
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

export function useUpdateLabel(boardId: string) {
  return useMutation({
    mutationFn: (input: { labelId: string; name?: string; color?: string; description?: string }) => {
      const { labelId, ...rest } = input;
      return api.patch(`/api/boards/${boardId}/labels/${labelId}`, rest);
    },
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

export function useDeleteLabel(boardId: string) {
  return useMutation({
    mutationFn: (labelId: string) => api.delete(`/api/boards/${boardId}/labels/${labelId}`),
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

export function useUpdateColumn(boardId: string) {
  return useMutation({
    mutationFn: (input: { columnKey: ColumnKey; name?: string; wipLimit?: number | null }) => {
      const { columnKey, ...rest } = input;
      return api.patch(`/api/boards/${boardId}/columns/${columnKey}`, rest);
    },
    onSuccess: () => {
      invalidateEntity('board', boardId);
    },
  });
}

// ─────────────────────────── Аналитика и активность ─────────────────────────

export function useBoardAnalytics(boardId: string | undefined, days = 30) {
  return useQuery({
    queryKey: queryKeys.boardAnalytics(boardId ?? '', days),
    queryFn: () =>
      api
        .get<{ analytics: BoardAnalyticsDto }>(`/api/boards/${boardId}/analytics`, { days })
        .then((response) => response.analytics),
    enabled: Boolean(boardId),
    staleTime: 120_000,
  });
}

export function useBoardActivity(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boardActivity(boardId ?? ''),
    queryFn: () =>
      api
        .get<{ items: ActivityDto[]; nextCursor: string | null }>(`/api/boards/${boardId}/activity`, {
          limit: 50,
        })
        .then((response) => response.items),
    enabled: Boolean(boardId),
  });
}
