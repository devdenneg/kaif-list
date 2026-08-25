import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { SOCKET_EVENTS, type NotificationDto } from '@kaif/shared';
import { useMarkNotificationsRead, useNotifications, useUnreadCount } from '@/api/notifications';
import { getSocket } from '@/lib/socket';
import { queryKeys } from '@/lib/query-client';
import { formatRelative, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { toast } from '@/lib/toast';

/** Колокольчик с живым счётчиком непрочитанных. */
export function NotificationBell(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const { data: unread = 0 } = useUnreadCount();
  const { data: notifications, isLoading } = useNotifications(false);
  const markRead = useMarkNotificationsRead();

  // Реалтайм: новое уведомление сразу обновляет счётчик и показывает тост.
  React.useEffect(() => {
    const socket = getSocket();

    const onNew = (notification: NotificationDto): void => {
      queryClient.setQueryData<number>(queryKeys.notificationCount, (value) => (value ?? 0) + 1);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // Событие почти всегда касается задачи, которая есть в «Моих задачах».
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });

      toast.info(notification.title, notification.body.slice(0, 120));
    };

    const onCount = (payload: { unread: number }): void => {
      queryClient.setQueryData(queryKeys.notificationCount, payload.unread);
    };

    socket.on(SOCKET_EVENTS.NOTIFICATION_NEW, onNew);
    socket.on(SOCKET_EVENTS.NOTIFICATION_COUNT, onCount);
    return () => {
      socket.off(SOCKET_EVENTS.NOTIFICATION_NEW, onNew);
      socket.off(SOCKET_EVENTS.NOTIFICATION_COUNT, onCount);
    };
  }, [queryClient]);

  const openNotification = (notification: NotificationDto): void => {
    if (!notification.readAt) markRead.mutate({ ids: [notification.id] });
    setOpen(false);
    if (notification.taskKey) navigate(`/tasks/${notification.taskKey}`);
    else if (notification.boardId) navigate('/boards');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Уведомления">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] w-[min(24rem,calc(100vw-env(safe-area-inset-left)-env(safe-area-inset-right)-1.5rem))] flex-col overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">Уведомления</h3>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => markRead.mutate({})}
              loading={markRead.isPending}
            >
              <CheckCheck />
              Прочитать все
            </Button>
          )}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-md" />
              ))}
            </div>
          ) : (notifications ?? []).length === 0 ? (
            <EmptyState
              className="m-3 border-0"
              icon={<Bell />}
              title="Пока тихо"
              description="Здесь появятся события по вашим задачам."
            />
          ) : (
            <ul>
              {(notifications ?? []).map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      'flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-secondary/60',
                      !notification.readAt && 'bg-accent/40',
                    )}
                  >
                    <UserAvatar user={notification.actor} size="sm" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{notification.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {notification.body}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {notification.taskKey ? `${notification.taskKey} · ` : ''}
                        {formatRelative(notification.createdAt)}
                      </p>
                    </div>
                    {!notification.readAt && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
          >
            Все уведомления
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
