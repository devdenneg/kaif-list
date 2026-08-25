import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useMarkNotificationsRead, useNotifications } from '@/api/notifications';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { formatRelative, cn } from '@/lib/utils';

/** Полный список уведомлений — основной способ читать события на телефоне. */
export function NotificationsPage(): React.ReactElement {
  const navigate = useNavigate();
  const [onlyUnread, setOnlyUnread] = React.useState(false);
  const { data: notifications, isLoading } = useNotifications(onlyUnread);
  const markRead = useMarkNotificationsRead();

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Уведомления</h1>
          <p className="text-sm text-muted-foreground">События по вашим задачам и доскам</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => markRead.mutate({})} loading={markRead.isPending}>
          <CheckCheck />
          Прочитать все
        </Button>
      </header>

      <Tabs
        value={onlyUnread ? 'unread' : 'all'}
        onValueChange={(value) => setOnlyUnread(value === 'unread')}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="unread">Непрочитанные</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (notifications ?? []).length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={onlyUnread ? 'Всё прочитано' : 'Уведомлений нет'}
          description="Здесь появятся назначения, комментарии и изменения статусов."
        />
      ) : (
        <ul className="space-y-1.5">
          {(notifications ?? []).map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => {
                  if (!notification.readAt) markRead.mutate({ ids: [notification.id] });
                  if (notification.taskKey) navigate(`/tasks/${notification.taskKey}`);
                }}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-secondary/50',
                  notification.readAt ? 'border-border bg-card' : 'border-primary/30 bg-accent/40',
                )}
              >
                <UserAvatar user={notification.actor} size="md" className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {notification.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[notification.taskKey, notification.boardName]
                      .filter(Boolean)
                      .join(' · ')}
                    {' · '}
                    {formatRelative(notification.createdAt)}
                  </p>
                </div>
                {!notification.readAt && (
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
