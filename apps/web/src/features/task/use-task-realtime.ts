import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SOCKET_EVENTS,
  type CommentDto,
  type PresenceUser,
  type TaskDetailDto,
} from '@kaif/shared';
import { getSocket, subscribeToTask, unsubscribeFromTask } from '@/lib/socket';
import { queryKeys } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth';

/**
 * Живая карточка задачи.
 *
 * Подписка на комнату задачи сама по себе ничего не даёт — нужно ещё
 * обрабатывать события. Здесь это и происходит: комментарии появляются
 * без перезагрузки, вложения и поля подтягиваются, а если задачу удалили —
 * карточка закрывается, а не показывает то, чего уже нет.
 *
 * Новый комментарий кладём в кеш напрямую из события: перезапрашивать всё
 * обсуждение ради одной реплики — лишний запрос и заметное мигание.
 */
export function useTaskRealtime(
  taskId: string | undefined,
  boardId: string | undefined,
  options: { onDeleted?: () => void } = {},
): PresenceUser[] {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const onDeleted = options.onDeleted;
  const [viewers, setViewers] = React.useState<PresenceUser[]>([]);

  // Держим колбэк в ref: иначе смена ссылки пересоздавала бы подписки.
  const onDeletedRef = React.useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  React.useEffect(() => {
    if (!taskId || !boardId) return;
    const socket = getSocket();

    const isThisTask = (payload: { taskId?: string }): boolean => payload.taskId === taskId;

    const onCommentCreated = (payload: {
      taskId?: string;
      commentId?: string;
      comment?: CommentDto;
    }): void => {
      if (!isThisTask(payload)) return;

      const comment = payload.comment;

      // Свой комментарий уже добавлен ответом на мутацию — второй раз не нужно.
      if (comment?.author?.id && comment.author.id === currentUserId) return;

      // Ответы в треде живут внутри своего комментария, в общем списке их нет.
      if (!comment || comment.parentId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
        return;
      }

      queryClient.setQueryData<CommentDto[]>(queryKeys.taskComments(taskId), (current) => {
        if (!current) return current;
        if (current.some((item) => item.id === comment.id)) return current;
        return [...current, normalizeComment(comment, currentUserId)];
      });

      // Счётчик на карточке доски меняем на месте, без похода на сервер.
      queryClient.setQueryData<TaskDetailDto>(queryKeys.task(taskId), (task) =>
        task ? { ...task, commentCount: task.commentCount + 1 } : task,
      );
    };

    const onCommentUpdated = (payload: { taskId?: string; comment?: CommentDto }): void => {
      if (!isThisTask(payload) || !payload.comment) return;
      const comment = payload.comment;
      queryClient.setQueryData<CommentDto[]>(queryKeys.taskComments(taskId), (current) =>
        current?.map((item) =>
          item.id === comment.id ? normalizeComment(comment, currentUserId) : item,
        ),
      );
    };

    const onCommentDeleted = (payload: { taskId?: string }): void => {
      if (!isThisTask(payload)) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    };

    const onTaskUpdated = (payload: { taskId?: string; actorId?: string }): void => {
      if (!isThisTask(payload)) return;
      // Свои изменения уже применены ответом сервера — лишний запрос только мигнёт.
      if (payload.actorId && payload.actorId === currentUserId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) });
    };

    const onAttachmentChanged = (payload: { taskId?: string }): void => {
      if (!isThisTask(payload)) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    };

    const onTaskDeleted = (payload: { taskId?: string; actorId?: string }): void => {
      if (!isThisTask(payload)) return;
      if (payload.actorId === currentUserId) return;
      onDeletedRef.current?.();
    };

    /**
     * Кто ещё смотрит эту задачу прямо сейчас.
     * Присутствие рассылается по комнате доски, поэтому на отдельной странице
     * задачи список будет пустым — это нормально, индикатор просто не покажется.
     */
    const onPresence = (payload: { users?: PresenceUser[] }): void => {
      setViewers(
        (payload.users ?? []).filter(
          (user) => user.taskId === taskId && user.userId !== currentUserId,
        ),
      );
    };

    socket.on(SOCKET_EVENTS.COMMENT_CREATED, onCommentCreated);
    socket.on(SOCKET_EVENTS.COMMENT_UPDATED, onCommentUpdated);
    socket.on(SOCKET_EVENTS.COMMENT_DELETED, onCommentDeleted);
    socket.on(SOCKET_EVENTS.TASK_UPDATED, onTaskUpdated);
    socket.on(SOCKET_EVENTS.ATTACHMENT_CHANGED, onAttachmentChanged);
    socket.on(SOCKET_EVENTS.TASK_DELETED, onTaskDeleted);
    socket.on(SOCKET_EVENTS.PRESENCE_SYNC, onPresence);

    // Комнату надо занять заново после каждого переподключения.
    const join = (): void => subscribeToTask(taskId, boardId);
    join();
    socket.on('connect', join);

    return () => {
      socket.off(SOCKET_EVENTS.COMMENT_CREATED, onCommentCreated);
      socket.off(SOCKET_EVENTS.COMMENT_UPDATED, onCommentUpdated);
      socket.off(SOCKET_EVENTS.COMMENT_DELETED, onCommentDeleted);
      socket.off(SOCKET_EVENTS.TASK_UPDATED, onTaskUpdated);
      socket.off(SOCKET_EVENTS.ATTACHMENT_CHANGED, onAttachmentChanged);
      socket.off(SOCKET_EVENTS.TASK_DELETED, onTaskDeleted);
      socket.off(SOCKET_EVENTS.PRESENCE_SYNC, onPresence);
      socket.off('connect', join);
      unsubscribeFromTask(taskId, boardId);
      setViewers([]);
    };
  }, [taskId, boardId, queryClient, currentUserId]);

  return viewers;
}

/**
 * Флаг «моя реакция» сервер считает относительно того, кто её поставил.
 * Для остальных зрителей его нужно пересчитать, иначе чужая реакция
 * подсветится как своя.
 */
function normalizeComment(comment: CommentDto, currentUserId: string | undefined): CommentDto {
  if (comment.reactions.length === 0) return comment;
  return {
    ...comment,
    reactions: comment.reactions.map((reaction) => ({
      ...reaction,
      mine: currentUserId ? reaction.users.some((user) => user.id === currentUserId) : false,
    })),
  };
}
