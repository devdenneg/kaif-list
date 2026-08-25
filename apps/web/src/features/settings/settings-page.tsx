import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bell,
  Camera,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  Send,
  Shield,
  Sun,
  User as UserIcon,
} from 'lucide-react';
import { DEFAULT_TIMEZONE, type NotificationPreferences } from '@kaif/shared';
import {
  useNotificationPreferences,
  useRevokeSession,
  useSessions,
  useUpdateNotificationPreferences,
  useUpdateProfile,
  useUploadAvatar,
} from '@/api/users';
import { useAuthStore } from '@/stores/auth';
import { useUiStore, type Theme } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Separator,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRelative, cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

const TIMEZONES = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Vladivostok',
  'Asia/Almaty',
  'Asia/Tbilisi',
  'Asia/Dubai',
  'UTC',
];

export function SettingsPage(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'profile';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:p-6">
      <h1 className="mb-5 text-xl font-semibold tracking-tight sm:text-2xl">Настройки</h1>

      <Tabs
        value={tab}
        onValueChange={(value) => setSearchParams({ tab: value }, { replace: true })}
      >
        <TabsList className="scrollbar-thin mb-6 h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
          <TabsTrigger value="profile" className="shrink-0 [&_svg]:!size-5">
            <UserIcon />
            Профиль
          </TabsTrigger>
          <TabsTrigger value="notifications" className="shrink-0 [&_svg]:!size-5">
            <Bell />
            Уведомления
          </TabsTrigger>
          <TabsTrigger value="security" className="shrink-0 [&_svg]:!size-5">
            <Shield />
            Безопасность
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileSettings(): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = React.useState(user?.displayName ?? '');
  const [timezone, setTimezone] = React.useState(user?.timezone ?? DEFAULT_TIMEZONE);

  if (!user) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">Как вас видят коллеги</h2>

        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative self-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:mt-1 sm:self-auto"
            aria-label="Сменить аватар"
          >
            <UserAvatar user={user} size="xl" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5 text-white" />
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 hidden size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-card [@media(pointer:coarse)]:flex">
              <Camera className="size-4" aria-hidden />
            </span>
          </button>

          <div className="min-w-0 flex-1 space-y-4">
            <FormField label="Имя">
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </FormField>
            <FormField label="Часовой пояс" hint="Влияет на дедлайны и время утренней сводки">
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([timezone, ...TIMEZONES])].map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </div>

        <Button
          variant="primary"
          className="mt-5 w-full xs:w-auto"
          loading={updateProfile.isPending}
          onClick={() =>
            updateProfile.mutate(
              { displayName: displayName.trim(), timezone },
              {
                onSuccess: () => toast.success('Профиль сохранён'),
                onError: (error) => toast.error('Не удалось сохранить', error),
              },
            )
          }
        >
          Сохранить
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            uploadAvatar.mutate(file, {
              onSuccess: () => toast.success('Аватар обновлён'),
              onError: (error) => toast.error('Не удалось загрузить', error),
            });
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Оформление</h2>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'light', label: 'Светлая', icon: <Sun className="size-4" /> },
              { value: 'dark', label: 'Тёмная', icon: <Moon className="size-4" /> },
              { value: 'system', label: 'Как в системе', icon: <Monitor className="size-4" /> },
            ] as { value: Theme; label: string; icon: React.ReactNode }[]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={cn(
                'flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:p-3 [&_svg]:!size-4',
                theme === option.value
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border hover:bg-secondary',
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4" aria-hidden />
          Telegram
        </h2>
        {user.botLinked ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Бот подключён{user.tgUsername ? ` к @${user.tgUsername}` : ''}. Уведомления приходят в
            личный чат.
            {user.botBlocked && (
              <span className="mt-1 block text-warning">
                Похоже, бот заблокирован — разблокируйте его, чтобы снова получать уведомления.
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-warning">
            Бот не подключён. Отправьте боту команду /start — иначе уведомления в Telegram приходить
            не будут.
          </p>
        )}
      </section>
    </div>
  );
}

function NotificationSettings(): React.ReactElement {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (isLoading || !preferences) return <Skeleton className="h-80 rounded-xl" />;

  const patch = (value: Partial<NotificationPreferences>): void => {
    update.mutate(value, {
      onError: (error) => toast.error('Не удалось сохранить настройку', error),
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-3 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Telegram</h2>

        <Toggle
          label="Присылать уведомления в Telegram"
          hint="Упоминания и назначения на вас приходят всегда"
          checked={preferences.telegramEnabled}
          onChange={(value) => patch({ telegramEnabled: value })}
        />
        <Toggle
          label="Только то, что касается меня"
          hint="Не получать уведомления о чужих действиях в задачах, где вы наблюдатель"
          checked={preferences.onlyMine}
          onChange={(value) => patch({ onlyMine: value })}
        />
        <Toggle
          label="Напоминания о дедлайнах"
          hint="За 24 часа, за 2 часа и в момент просрочки"
          checked={preferences.dueReminders}
          onChange={(value) => patch({ dueReminders: value })}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-3 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Утренняя сводка</h2>
        <Toggle
          label="Присылать сводку"
          hint="Что просрочено, что горит сегодня и что в работе"
          checked={preferences.digestEnabled}
          onChange={(value) => patch({ digestEnabled: value })}
        />
        {preferences.digestEnabled && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-3 pb-1">
            <span className="text-sm text-muted-foreground">Время</span>
            <Input
              type="time"
              value={preferences.digestTime}
              onChange={(event) => patch({ digestTime: event.target.value })}
              className="w-32"
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-3 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Тихие часы</h2>
        <Toggle
          label="Не беспокоить ночью"
          hint="Обычные уведомления подождут до утра. Упоминания придут в любом случае."
          checked={preferences.quietHoursEnabled}
          onChange={(value) => patch({ quietHoursEnabled: value })}
        />
        {preferences.quietHoursEnabled && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-3 pb-1">
            <Input
              type="time"
              value={preferences.quietHoursStart}
              onChange={(event) => patch({ quietHoursStart: event.target.value })}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">—</span>
            <Input
              type="time"
              value={preferences.quietHoursEnd}
              onChange={(event) => patch({ quietHoursEnd: event.target.value })}
              className="w-32"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SecuritySettings(): React.ReactElement {
  const { data: sessions, isLoading } = useSessions();
  const revokeSession = useRevokeSession();
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">Активные сессии</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Если видите незнакомое устройство — завершите сессию и сообщите администратору.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {(sessions ?? []).map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-3"
              >
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {session.userAgent ?? 'Неизвестное устройство'}
                    {session.current && (
                      <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                        текущая
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.ip ?? '—'} · активность{' '}
                    {formatRelative(session.lastUsedAt ?? session.createdAt)}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-7 w-full xs:ml-0 xs:w-auto"
                    onClick={() => revokeSession.mutate(session.id)}
                    loading={revokeSession.isPending}
                  >
                    Завершить
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <Separator className="my-4" />

        <Button variant="danger" size="sm" onClick={() => void logout()}>
          <LogOut />
          Выйти из аккаунта
        </Button>
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors hover:bg-secondary/50">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}
