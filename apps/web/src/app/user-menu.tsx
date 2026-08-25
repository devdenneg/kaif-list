import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Monitor, Moon, Shield, Sun, User } from 'lucide-react';
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
          className="inline-flex h-10 max-w-10 items-center gap-2 overflow-hidden rounded-full border border-border/80 bg-secondary/60 p-1 text-sm font-medium leading-none text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:ring-offset-0 data-[state=open]:bg-secondary md:max-w-64 md:pr-3"
          aria-label="Меню профиля"
        >
          <UserAvatar user={user} size="md" />
          <span className="hidden min-w-0 truncate md:block">{user.displayName}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-72 max-w-[calc(100vw-1.5rem)] [&_svg]:!size-4"
      >
        <div className="flex items-center gap-3 px-3 py-3">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            {user.tgUsername && (
              <p className="truncate text-xs text-muted-foreground">@{user.tgUsername}</p>
            )}
          </div>
        </div>

        {!user.botLinked && (
          <div className="mx-2 mb-2 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
            Бот не подключён — уведомления в Telegram не придут
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <User />
          Профиль
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings?tab=notifications')}>
          <Bell />
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
