import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { can } from '@kaif/shared';
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
  const location = useLocation();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const [createBoardOpen, setCreateBoardOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const mainRef = React.useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    // Основная область не размонтируется между маршрутами, поэтому явно
    // начинаем каждую новую страницу с её начала.
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  useHotkeys({
    'mod+k': () => setCommandPaletteOpen(true),
    '/': () => setCommandPaletteOpen(true),
    '?': () => setShortcutsOpen(true),
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      {!isMobile && (
        <Sidebar collapsed={collapsed} onCreateBoard={() => setCreateBoardOpen(true)} />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar onCreateBoard={() => setCreateBoardOpen(true)} />
        <main
          ref={mainRef}
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-y-auto',
            isMobile && 'pb-[calc(4rem+env(safe-area-inset-bottom))]',
          )}
        >
          {children}
        </main>
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
      id="app-sidebar"
      aria-label="Боковая навигация"
      className={cn(
        'z-20 flex h-full flex-none flex-col overflow-hidden border-r border-border bg-surface',
        'transition-[width,min-width,max-width,flex-basis] duration-200 ease-out motion-reduce:transition-none',
        collapsed
          ? 'w-16 min-w-[4rem] max-w-[4rem] basis-[4rem]'
          : 'w-60 min-w-[15rem] max-w-[15rem] basis-[15rem]',
      )}
    >
      <div className="relative h-14 shrink-0 overflow-hidden border-b border-border">
        {/* Логотип всегда остаётся логотипом и сохраняет один центр. При раскрытии
            меняется только ширина ссылки и проявляется название продукта. */}
        <Link
          to="/boards"
          aria-label={collapsed ? 'Все доски' : undefined}
          className={cn(
            'absolute left-3 top-2 flex h-10 min-w-0 items-center overflow-hidden rounded-lg',
            'transition-[width] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            collapsed ? 'w-10' : 'w-[calc(100%-1.5rem)]',
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KanbanSquare className="size-5" aria-hidden />
          </span>
          <span
            className={cn(
              'ml-2 truncate text-sm font-semibold transition-opacity duration-150 motion-reduce:transition-none',
              collapsed ? 'opacity-0' : 'delay-75 opacity-100',
            )}
          >
            Kaif Board
          </span>
        </Link>
      </div>

      <nav
        aria-label="Основная навигация"
        className={cn(
          'scrollbar-thin flex min-h-0 flex-1 flex-col space-y-1 overflow-x-hidden overflow-y-auto py-2',
          collapsed ? 'items-center px-3' : 'px-2',
        )}
      >
        <SidebarLink to="/my" icon={ListTodo} label="Мои задачи" collapsed={collapsed} />
        <SidebarLink to="/boards" icon={LayoutGrid} label="Все доски" collapsed={collapsed} end />

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
          <Tooltip content={collapsed ? 'Новая доска' : null} side="right">
            <Button
              variant="ghost"
              size={collapsed ? 'icon' : 'md'}
              className={cn(
                'text-muted-foreground [&_svg]:!size-5',
                collapsed ? 'mx-auto flex size-10 px-0' : 'w-full justify-start px-[15px]',
              )}
              onClick={onCreateBoard}
              aria-label={collapsed ? 'Новая доска' : undefined}
            >
              <Plus />
              {!collapsed && 'Новая доска'}
            </Button>
          </Tooltip>
        </div>
      </nav>

      <div
        className={cn(
          'shrink-0 border-t border-border p-2',
          collapsed ? 'flex flex-col items-center gap-1' : 'space-y-1',
        )}
      >
        {isSuperAdmin && (
          <SidebarLink to="/admin" icon={Shield} label="Администрирование" collapsed={collapsed} />
        )}
        <SidebarLink to="/settings" icon={Settings} label="Настройки" collapsed={collapsed} />
        <Tooltip content={collapsed ? 'Развернуть панель' : null} side="right" delay={250}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'md'}
            className={cn(
              'text-muted-foreground [&_svg]:!size-5',
              collapsed ? 'size-10 px-0' : 'w-full justify-start px-[15px]',
            )}
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsed && 'Свернуть панель'}
          </Button>
        </Tooltip>
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
    <div className={cn('w-full pt-3', collapsed && 'mt-2 border-t border-border/70 pt-2')}>
      {!collapsed && (
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <div className={cn('space-y-0.5', collapsed && 'flex flex-col items-center')}>{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  collapsed,
  end,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  end?: boolean;
}): React.ReactElement {
  const link = (
    <NavLink
      to={to}
      end={end}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'h-10 min-h-10 shrink-0 rounded-lg text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          collapsed
            ? 'mx-auto grid w-10 place-items-center px-0'
            : 'flex w-full items-center justify-start gap-2.5 px-3.5',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <Icon className="size-5" aria-hidden />
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
  board: {
    id: string;
    key: string;
    name: string;
    color: string;
    isFavorite: boolean;
    counts: { overdue: number };
  };
  collapsed: boolean;
}): React.ReactElement {
  const monogram = Array.from(board.name.trim())[0]?.toUpperCase() ?? board.key.slice(0, 1);
  const link = (
    <NavLink
      to={`/boards/${board.key}`}
      aria-label={collapsed ? board.name : undefined}
      className={({ isActive }) =>
        cn(
          'group h-10 min-h-10 shrink-0 rounded-lg text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          collapsed
            ? 'mx-auto grid w-10 place-items-center px-0'
            : 'flex w-full items-center justify-start gap-2.5 px-[19px]',
          isActive
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <span
        className={cn(
          'shrink-0',
          collapsed
            ? 'flex size-7 items-center justify-center rounded-md border bg-secondary text-[11px] font-bold leading-none'
            : 'size-2.5 rounded-sm',
        )}
        style={
          collapsed
            ? { borderColor: board.color, color: board.color }
            : { backgroundColor: board.color }
        }
        aria-hidden
      >
        {collapsed ? monogram : null}
      </span>
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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md md:px-4">
      {isMobile && (
        <Link
          to="/boards"
          className="flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Все доски"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KanbanSquare aria-hidden />
          </span>
        </Link>
      )}

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className={cn(
          'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground',
          'transition-colors hover:border-ring/60 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md',
        )}
        aria-label="Открыть поиск"
      >
        <Search aria-hidden />
        <span className="truncate sm:hidden">Поиск</span>
        <span className="hidden truncate sm:inline">Поиск задач, досок, людей…</span>
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
  const currentUser = useAuthStore((state) => state.user);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  // На доске главное действие — создать задачу, а не ещё одну доску.
  const onBoardPage = /^\/boards\/[^/]+$/.test(location.pathname);
  const lastBoardId = useUiStore((state) => state.lastBoardId);
  const { data: boards } = useBoards();
  const lastBoard = boards?.find((board) => board.id === lastBoardId) ?? boards?.[0];
  const currentBoardKey = onBoardPage ? location.pathname.split('/')[2] : undefined;
  const currentBoard = boards?.find((board) => board.key === currentBoardKey);
  const canCreateTask = Boolean(
    currentUser &&
    currentBoard &&
    can(
      {
        globalRole: currentUser.globalRole,
        boardRole: currentBoard.myRole,
        boardArchived: currentBoard.isArchived,
      },
      'task.create',
    ),
  );

  const firstItems = [
    { to: '/my', icon: ListTodo, label: 'Мои' },
    {
      to: lastBoard ? `/boards/${lastBoard.key}` : '/boards',
      icon: KanbanSquare,
      label: 'Доска',
      // Без доступных досок этот пункт ведёт к списку, но не дублирует его active-состояние.
      suppressActive: !lastBoard,
    },
  ];
  const lastItems = [
    { to: '/boards', icon: LayoutGrid, label: 'Доски', end: true },
    { to: '/notifications', icon: Bell, label: 'События' },
  ];

  const renderItem = (item: {
    to: string;
    icon: LucideIcon;
    label: string;
    end?: boolean;
    suppressActive?: boolean;
  }): React.ReactElement => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.label}
        to={item.to}
        end={item.end}
        aria-current={item.suppressActive ? false : undefined}
        className={({ isActive }) =>
          cn(
            'flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            isActive && !item.suppressActive
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )
        }
      >
        <Icon aria-hidden />
        <span className="max-w-full truncate px-1">{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] backdrop-blur-md"
    >
      {firstItems.map(renderItem)}
      <button
        type="button"
        onClick={() => {
          if (onBoardPage && canCreateTask) {
            // Страница доски сама откроет диалог по этому параметру.
            navigate(`${location.pathname}?new=task`, { replace: true });
            return;
          }
          if (onBoardPage) {
            setCommandPaletteOpen(true);
            return;
          }
          onCreateBoard();
        }}
        className={cn(
          'flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-semibold text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
        aria-label={
          onBoardPage ? (canCreateTask ? 'Создать задачу' : 'Открыть поиск') : 'Создать доску'
        }
      >
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full shadow-sm',
            !onBoardPage || canCreateTask
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-foreground',
          )}
        >
          {onBoardPage && !canCreateTask ? <Search aria-hidden /> : <Plus aria-hidden />}
        </span>
        <span className="max-w-full truncate px-1">
          {onBoardPage ? (canCreateTask ? 'Задача' : 'Поиск') : 'Доска'}
        </span>
      </button>
      {lastItems.map(renderItem)}
    </nav>
  );
}
