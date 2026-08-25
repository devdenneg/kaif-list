import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Settings, Shield, Sun, User } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useUiStore, type Theme } from '@/stores/ui';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu(): React.ReactElement | null {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Меню профиля"
        >
          <UserAvatar user={user} size="md" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            {user.tgUsername && (
              <p className="truncate text-xs text-muted-foreground">@{user.tgUsername}</p>
            )}
          </div>
        </div>

        {!user.botLinked && (
          <div className="mx-1 mb-1 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
            Бот не подключён — уведомления в Telegram не придут
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <User />
          Профиль
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings?tab=notifications')}>
          <Settings />
          Уведомления
        </DropdownMenuItem>
        {user.globalRole === 'SUPERADMIN' && (
          <DropdownMenuItem onSelect={() => navigate('/admin')}>
            <Shield />
            Администрирование
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Тема</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" />
            Светлая
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" />
            Тёмная
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" />
            Как в системе
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
