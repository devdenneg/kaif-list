import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SOCKET_EVENTS, type PresenceSyncPayload, type PresenceUser } from '@kaif/shared';
import { getSocket, subscribeToBoard, unsubscribeFromBoard } from '@/lib/socket';
import { queryKeys } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth';

/**
 * Живая доска.
 *
 * Подписываемся на комнату доски и точечно инвалидируем кеш: перерисовывается
 * только то, что изменилось. Свои же изменения игнорируем — их уже применил
 * оптимистичный апдейт, повторный запрос только мигнёт интерфейсом.
 */
export function useBoardRealtime(boardId: string | undefined): PresenceUser[] {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [presence, setPresence] = React.useState<PresenceUser[]>([]);

  React.useEffect(() => {
    if (!boardId) return;
    const socket = getSocket();

    const invalidateBoard = (payload: { boardId?: string; actorId?: string }): void => {
      if (payload.boardId && payload.boardId !== boardId) return;
      if (payload.actorId && payload.actorId === currentUserId) return;
      void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
    };

    const invalidateTask = (payload: { taskId?: string; actorId?: string; boardId?: string }): void => {
      if (payload.boardId && payload.boardId !== boardId) return;
      if (payload.taskId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.task(payload.taskId) });
      }
      if (payload.actorId === currentUserId) return;
      void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
    };

    const onPresence = (payload: PresenceSyncPayload): void => {
      if (payload.boardId !== boardId) return;
      setPresence(payload.users.filter((user) => user.userId !== currentUserId));
    };

    socket.on(SOCKET_EVENTS.TASK_CREATED, invalidateBoard);
    socket.on(SOCKET_EVENTS.TASK_UPDATED, invalidateTask);
    socket.on(SOCKET_EVENTS.TASK_MOVED, invalidateBoard);
    socket.on(SOCKET_EVENTS.TASK_DELETED, invalidateBoard);
    socket.on(SOCKET_EVENTS.BOARD_UPDATED, invalidateBoard);
    socket.on(SOCKET_EVENTS.BOARD_MEMBERS_CHANGED, invalidateBoard);
    socket.on(SOCKET_EVENTS.PRESENCE_SYNC, onPresence);

    const join = (): void => subscribeToBoard(boardId);
    join();
    socket.on('connect', join);

    return () => {
      socket.off(SOCKET_EVENTS.TASK_CREATED, invalidateBoard);
      socket.off(SOCKET_EVENTS.TASK_UPDATED, invalidateTask);
      socket.off(SOCKET_EVENTS.TASK_MOVED, invalidateBoard);
      socket.off(SOCKET_EVENTS.TASK_DELETED, invalidateBoard);
      socket.off(SOCKET_EVENTS.BOARD_UPDATED, invalidateBoard);
      socket.off(SOCKET_EVENTS.BOARD_MEMBERS_CHANGED, invalidateBoard);
      socket.off(SOCKET_EVENTS.PRESENCE_SYNC, onPresence);
      socket.off('connect', join);
      unsubscribeFromBoard(boardId);
      setPresence([]);
    };
  }, [boardId, queryClient, currentUserId]);

  return presence;
}
