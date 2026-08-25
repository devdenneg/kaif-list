import { useQuery } from '@tanstack/react-query';
import type { PublicUser, TaskCardDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export interface SearchResult {
  tasks: TaskCardDto[];
  boards: { id: string; key: string; name: string; color: string }[];
  users: PublicUser[];
}

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed),
    queryFn: () => api.get<SearchResult>('/api/search', { q: trimmed, limit: 8 }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}
