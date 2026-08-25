import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Inbox,
  LayoutGrid,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { GlobalRole } from '@kaif/shared';
import {
  useAdminBoards,
  useAdminStats,
  useAdminUsers,
  useGlobalBacklog,
  useSecurityEvents,
  useSetUserActive,
  useSetUserRole,
  type AdminUser,
} from '@/api/admin';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { formatRelative, cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import {
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TaskCard } from '@/features/board/task-card';

/**
 * Административная панель.
 *
 * Суперадмин видит все доски и все задачи, управляет людьми,
 * имеет глобальный банк задач и журнал безопасности.
 */
export function AdminPage(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <Shield className="size-5 text-muted-foreground" />
          Администрирование
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Полный обзор системы: люди, доски, задачи и события безопасности
        </p>
      </header>

      <Tabs defaultValue="overview">
        <TabsList className="scrollbar-thin mb-5 h-auto w-full max-w-full justify-start overflow-x-auto p-1">
          <TabsTrigger value="overview" className="shrink-0 [&_svg]:!size-5">
            <Activity />
            Обзор
          </TabsTrigger>
          <TabsTrigger value="users" className="shrink-0 [&_svg]:!size-5">
            <Users />
            Пользователи
          </TabsTrigger>
          <TabsTrigger value="boards" className="shrink-0 [&_svg]:!size-5">
            <LayoutGrid />
            Доски
          </TabsTrigger>
          <TabsTrigger value="backlog" className="shrink-0 [&_svg]:!size-5">
            <Inbox />
            Банк задач
          </TabsTrigger>
          <TabsTrigger value="security" className="shrink-0 [&_svg]:!size-5">
            <ShieldCheck />
            Безопасность
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="boards">
          <BoardsTab />
        </TabsContent>
        <TabsContent value="backlog">
          <BacklogTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab(): React.ReactElement {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading || !stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: 'Пользователей', value: stats.users, hint: `активных: ${stats.activeUsers}` },
    { label: 'Досок', value: stats.boards },
    { label: 'Задач', value: stats.tasks, hint: `в бэклоге: ${stats.backlog}` },
    {
      label: 'Просрочено',
      value: stats.overdue,
      tone: stats.overdue > 0 ? ('danger' as const) : undefined,
    },
    { label: 'Закрыто за неделю', value: stats.doneWeek, tone: 'success' as const },
    { label: 'Создано за неделю', value: stats.createdWeek },
    {
      label: 'Подключено к боту',
      value: stats.linkedBots,
      hint: `${Math.round((stats.linkedBots / Math.max(stats.activeUsers, 1)) * 100)}% сотрудников`,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold',
              card.tone === 'danger' && 'text-destructive',
              card.tone === 'success' && 'text-success',
            )}
          >
            {card.value}
          </p>
          {card.hint && <p className="text-xs text-muted-foreground">{card.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function UsersTab(): React.ReactElement {
  const [search, setSearch] = React.useState('');
  const debounced = useDebounce(search, 250);
  const { data: users, isLoading } = useAdminUsers(debounced);
  const setRole = useSetUserRole();
  const setActive = useSetUserActive();
  const [target, setTarget] = React.useState<AdminUser | null>(null);

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск по имени или @username"
        icon={<Search />}
        className="sm:w-72"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (users ?? []).length === 0 ? (
        <EmptyState icon={<Users />} title="Никого не найдено" />
      ) : (
        <ul className="space-y-1.5">
          {(users ?? []).map((user) => (
            <li
              key={user.id}
              className={cn(
                'flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card p-3',
                !user.isActive && 'opacity-60',
              )}
            >
              <UserAvatar user={user} size="md" />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="min-w-0 max-w-full truncate text-sm font-medium">
                    {user.displayName}
                  </p>
                  {user.globalRole === GlobalRole.SUPERADMIN && (
                    <Badge variant="primary">
                      <Shield />
                      Администратор
                    </Badge>
                  )}
                  {!user.isActive && <Badge variant="danger">Отключён</Badge>}
                  {!user.profileCompleted && <Badge variant="warning">Профиль не заполнен</Badge>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:truncate">
                  {user.tgUsername ? `@${user.tgUsername} · ` : ''}
                  досок: {user.boards} · задач: {user.assignedTasks}
                  {user.lastSeenAt ? ` · был(а) ${formatRelative(user.lastSeenAt)}` : ''}
                </p>
              </div>

              <div className="flex w-full flex-col items-stretch gap-1.5 xs:flex-row xs:flex-wrap xs:items-center sm:w-auto sm:justify-end">
                {user.botLinked ? (
                  <Badge
                    variant={user.botBlocked ? 'danger' : 'success'}
                    className="w-fit self-start xs:self-auto"
                  >
                    {user.botBlocked ? 'бот заблокирован' : 'бот подключён'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="w-fit self-start xs:self-auto">
                    без бота
                  </Badge>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full xs:w-auto"
                  onClick={() =>
                    setRole.mutate(
                      {
                        userId: user.id,
                        role:
                          user.globalRole === GlobalRole.SUPERADMIN
                            ? GlobalRole.USER
                            : GlobalRole.SUPERADMIN,
                      },
                      {
                        onSuccess: () =>
                          toast.success('Роль изменена, сессии пользователя сброшены'),
                        onError: (error) => toast.error('Не удалось изменить роль', error),
                      },
                    )
                  }
                >
                  <Shield />
                  {user.globalRole === GlobalRole.SUPERADMIN ? 'Снять админа' : 'Сделать админом'}
                </Button>

                <Button
                  variant={user.isActive ? 'ghost' : 'outline'}
                  size="sm"
                  className="w-full xs:w-auto"
                  onClick={() => setTarget(user)}
                >
                  {user.isActive ? <UserX /> : <UserCheck />}
                  {user.isActive ? 'Отключить' : 'Включить'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
        title={
          target?.isActive ? `Отключить ${target.displayName}?` : `Включить ${target?.displayName}?`
        }
        description={
          target?.isActive
            ? 'Все сессии будут завершены, вход станет невозможен. Задачи и история сохранятся.'
            : 'Пользователь снова сможет входить в систему.'
        }
        confirmLabel={target?.isActive ? 'Отключить' : 'Включить'}
        variant={target?.isActive ? 'danger' : 'primary'}
        loading={setActive.isPending}
        onConfirm={() => {
          if (!target) return;
          setActive.mutate(
            { userId: target.id, isActive: !target.isActive },
            {
              onSuccess: () => {
                toast.success('Готово');
                setTarget(null);
              },
              onError: (error) => toast.error('Не удалось выполнить', error),
            },
          );
        }}
      />
    </div>
  );
}

function BoardsTab(): React.ReactElement {
  const navigate = useNavigate();
  const { data: boards, isLoading } = useAdminBoards();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {(boards ?? []).map((board) => (
        <li key={board.id}>
          <button
            type="button"
            onClick={() => navigate(`/boards/${board.key}`)}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-secondary/50"
          >
            <span className="size-3 shrink-0 rounded" style={{ backgroundColor: board.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{board.name}</p>
                {board.isArchived && <Badge variant="outline">архив</Badge>}
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:truncate">
                {board.key} · владелец: {board.owner.displayName} · участников: {board.members} ·
                задач: {board.tasks}
              </p>
            </div>
            <UserAvatar user={board.owner} size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function BacklogTab(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = React.useState('');
  const debounced = useDebounce(search, 250);
  const { data: tasks, isLoading } = useGlobalBacklog(debounced);

  return (
    <div className="space-y-3">
      <div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по всем бэклогам"
          icon={<Search />}
          className="sm:w-72"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Задачи из бэклогов всех досок — общий банк работы.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <EmptyState icon={<Inbox />} title="Банк задач пуст" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(tasks ?? []).map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => navigate(`/tasks/${task.key}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

const SECURITY_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Успешный вход',
  LOGIN_FAILED: 'Неудачная попытка входа',
  LOGIN_CODE_ISSUED: 'Выдан код входа',
  LOGIN_CODE_APPROVED: 'Код подтверждён в Telegram',
  TOKEN_REFRESHED: 'Обновление сессии',
  TOKEN_REUSE_DETECTED: 'Повторное использование токена',
  LOGOUT: 'Выход',
  LOGOUT_ALL: 'Выход на всех устройствах',
  SESSION_REVOKED: 'Сессия завершена',
  PROFILE_COMPLETED: 'Профиль заполнен',
  GLOBAL_ROLE_CHANGED: 'Изменена глобальная роль',
  USER_DEACTIVATED: 'Пользователь отключён',
  USER_REACTIVATED: 'Пользователь включён',
  RATE_LIMITED: 'Превышен лимит запросов',
  FORBIDDEN_ACCESS: 'Отказ в доступе',
};

const CRITICAL_EVENTS = new Set(['TOKEN_REUSE_DETECTED', 'LOGIN_FAILED', 'FORBIDDEN_ACCESS']);

function SecurityTab(): React.ReactElement {
  const { data: events, isLoading } = useSecurityEvents();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {(events ?? []).map((event) => (
        <li
          key={event.id}
          className={cn(
            'flex flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
            CRITICAL_EVENTS.has(event.type)
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border bg-card',
          )}
        >
          {CRITICAL_EVENTS.has(event.type) && (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          )}
          <UserAvatar user={event.user} size="xs" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{SECURITY_LABELS[event.type] ?? event.type}</span>
            {event.user && (
              <span className="text-muted-foreground"> · {event.user.displayName}</span>
            )}
          </span>
          <div className="flex w-full items-center justify-between gap-3 text-xs text-muted-foreground sm:ml-auto sm:w-auto sm:justify-start">
            <span className="min-w-0 truncate font-mono">{event.ip ?? '—'}</span>
            <span className="shrink-0">{formatRelative(event.createdAt)}</span>
          </div>
        </li>
      ))}
      {(events ?? []).length === 0 && <EmptyState title="Событий нет" />}
    </ul>
  );
}
