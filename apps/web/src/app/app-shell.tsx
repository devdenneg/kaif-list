import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronLeft,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
} from 'lucide-react';
import { useBoards } from '@/api/boards';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useIsMobile } from '@/lib/hooks/use-media-query';
import { useHotkeys } from '@/lib/hooks/use-hotkeys';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { UserMenu } from '@/app/user-menu';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { CommandPalette } from '@/app/command-palette';
import { ShortcutsDialog } from '@/app/shortcuts-dialog';
import { CreateBoardDialog } from '@/features/boards/create-board-dialog';

/**
 * Каркас приложения.
 *
 * Десктоп: боковая панель с досками + верхняя строка.
 * Мобильный: нижняя навигация большим пальцем и компактный заголовок.
 */
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const isMobile = useIsMobile();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const [createBoardOpen, setCreateBoardOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  useHotkeys({
    'mod+k': () => setCommandPaletteOpen(true),
    '/': () => setCommandPaletteOpen(true),
    '?': () => setShortcutsOpen(true),
  });

  return (
    <div className="flex min-h-screen bg-background">
      {!isMobile && (
        <Sidebar collapsed={collapsed} onCreateBoard={() => setCreateBoardOpen(true)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onCreateBoard={() => setCreateBoardOpen(true)} />
        <main className={cn('min-w-0 flex-1', isMobile && 'pb-16')}>{children}</main>
      </div>

      {isMobile && <MobileNav onCreateBoard={() => setCreateBoardOpen(true)} />}

      <CommandPalette />
      <CreateBoardDialog open={createBoardOpen} onOpenChange={setCreateBoardOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

// ──────────────────────────── Боковая панель ────────────────────────────────

function Sidebar({
  collapsed,
  onCreateBoard,
}: {
  collapsed: boolean;
  onCreateBoard: () => void;
}): React.ReactElement {
  const { data: boards } = useBoards();
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const isSuperAdmin = useAuthStore((state) => state.user?.globalRole === 'SUPERADMIN');

  const favorites = (boards ?? []).filter((board) => board.isFavorite);
  const rest = (boards ?? []).filter((board) => !board.isFavorite);

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-3">
        <Link to="/boards" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KanbanSquare className="size-4" />
          </span>
          {!collapsed && <span className="truncate font-semibold">Kaif Board</span>}
        </Link>
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={toggleSidebar}
            aria-label="Свернуть панель"
          >
            <ChevronLeft />
          </Button>
        )}
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2">
        <SidebarLink to="/my" icon={<ListTodo />} label="Мои задачи" collapsed={collapsed} />
        <SidebarLink to="/boards" icon={<LayoutGrid />} label="Все доски" collapsed={collapsed} end />

        {favorites.length > 0 && (
          <SidebarSection label="Избранное" collapsed={collapsed}>
            {favorites.map((board) => (
              <BoardLink key={board.id} board={board} collapsed={collapsed} />
            ))}
          </SidebarSection>
        )}

        {rest.length > 0 && (
          <SidebarSection label="Доски" collapsed={collapsed}>
            {rest.slice(0, 12).map((board) => (
              <BoardLink key={board.id} board={board} collapsed={collapsed} />
            ))}
          </SidebarSection>
        )}

        <div className="pt-2">
          <Button
            variant="ghost"
            className={cn('w-full justify-start text-muted-foreground', collapsed && 'justify-center px-0')}
            onClick={onCreateBoard}
          >
            <Plus />
            {!collapsed && 'Новая доска'}
          </Button>
        </div>
      </nav>

      <div className="space-y-1 border-t border-border p-2">
        {isSuperAdmin && (
          <SidebarLink to="/admin" icon={<Shield />} label="Администрирование" collapsed={collapsed} />
        )}
        <SidebarLink to="/settings" icon={<Settings />} label="Настройки" collapsed={collapsed} />
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="w-full"
            onClick={toggleSidebar}
            aria-label="Развернуть панель"
          >
            <ChevronLeft className="rotate-180" />
          </Button>
        )}
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="pt-3">
      {!collapsed && (
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  label,
  collapsed,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
}): React.ReactElement {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function BoardLink({
  board,
  collapsed,
}: {
  board: { id: string; key: string; name: string; color: string; isFavorite: boolean; counts: { overdue: number } };
  collapsed: boolean;
}): React.ReactElement {
  const link = (
    <NavLink
      to={`/boards/${board.key}`}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <span
        className="size-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: board.color }}
        aria-hidden
      />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{board.name}</span>
          {board.counts.overdue > 0 && (
            <span className="rounded bg-destructive/15 px-1 text-[10px] font-semibold text-destructive">
              {board.counts.overdue}
            </span>
          )}
          {board.isFavorite && <Star className="size-3 shrink-0 fill-warning text-warning" />}
        </>
      )}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={board.name} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

// ─────────────────────────────── Верхняя строка ─────────────────────────────

function TopBar({ onCreateBoard }: { onCreateBoard: () => void }): React.ReactElement {
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const isMobile = useIsMobile();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md sm:px-4">
      {isMobile && (
        <Link to="/boards" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KanbanSquare className="size-4" />
          </span>
        </Link>
      )}

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary sm:max-w-md"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Поиск задач, досок, людей…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {!isMobile && (
          <Button variant="ghost" size="icon" onClick={onCreateBoard} aria-label="Новая доска">
            <Plus />
          </Button>
        )}
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

// ─────────────────────────── Мобильная навигация ────────────────────────────

function MobileNav({ onCreateBoard }: { onCreateBoard: () => void }): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  // На доске главное действие — создать задачу, а не ещё одну доску.
  const onBoardPage = /^\/boards\/[^/]+$/.test(location.pathname);
  const lastBoardId = useUiStore((state) => state.lastBoardId);
  const { data: boards } = useBoards();
  const lastBoard = boards?.find((board) => board.id === lastBoardId) ?? boards?.[0];

  const items = [
    { to: '/my', icon: <ListTodo />, label: 'Мои' },
    {
      to: lastBoard ? `/boards/${lastBoard.key}` : '/boards',
      icon: <KanbanSquare />,
      label: 'Доска',
    },
    { to: '/boards', icon: <LayoutGrid />, label: 'Доски', end: true },
    { to: '/notifications', icon: <Bell />, label: 'События' },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      {items.map((item) => {
        const active = item.end
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to.split('?')[0] ?? item.to);
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.to)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors [&_svg]:size-5',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => {
          if (onBoardPage) {
            // Страница доски сама откроет диалог по этому параметру.
            navigate(`${location.pathname}?new=task`, { replace: true });
            return;
          }
          onCreateBoard();
        }}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-primary [&_svg]:size-5"
        aria-label={onBoardPage ? 'Создать задачу' : 'Создать доску'}
      >
        <Plus />
        {onBoardPage ? 'Задача' : 'Доска'}
      </button>
    </nav>
  );
}
