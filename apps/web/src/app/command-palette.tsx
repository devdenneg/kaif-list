import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CornerDownLeft,
  History,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Search,
  X,
} from 'lucide-react';
import { COLUMN_LABELS, PRIORITY_LABELS } from '@kaif/shared';
import { useSearch } from '@/api/search';
import { useUiStore } from '@/stores/ui';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { clearRecent, readRecent, rememberRecent, type RecentItem } from '@/lib/recent';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { UserAvatar } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/misc';

/**
 * Командная палитра (Cmd/Ctrl+K).
 *
 * Главный ускоритель работы: перейти к задаче по ключу, открыть доску,
 * найти человека — не трогая мышь.
 */
export function CommandPalette(): React.ReactElement {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const navigate = useNavigate();

  const [query, setQuery] = React.useState('');
  const [recent, setRecent] = React.useState<RecentItem[]>([]);
  const debounced = useDebounce(query, 220);
  const { data, isFetching } = useSearch(debounced);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const items = React.useMemo(() => {
    const result: {
      id: string;
      type: 'task' | 'board' | 'user' | 'nav';
      label: string;
      hint?: string;
      onSelect: () => void;
      icon: React.ReactNode;
    }[] = [];

    if (!debounced) {
      // Сначала то, к чему возвращались, потом переходы: в трекере работа
      // ходит кругами вокруг двух-трёх задач.
      for (const item of recent) {
        result.push({
          id: `recent-${item.type}-${item.key}`,
          type: item.type,
          label: item.type === 'task' ? `${item.key} · ${item.title}` : item.title,
          hint: 'недавнее',
          icon:
            item.type === 'board' ? (
              <span
                className="size-3 rounded-sm"
                style={{ backgroundColor: item.color ?? 'hsl(var(--muted-foreground))' }}
                aria-hidden
              />
            ) : (
              <History className="size-4" />
            ),
          onSelect: () =>
            navigate(item.type === 'task' ? `/tasks/${item.key}` : `/boards/${item.key}`),
        });
      }

      result.push(
        {
          id: 'nav-my',
          type: 'nav',
          label: 'Мои задачи',
          icon: <ListTodo className="size-4" />,
          onSelect: () => navigate('/my'),
        },
        {
          id: 'nav-boards',
          type: 'nav',
          label: 'Все доски',
          icon: <LayoutGrid className="size-4" />,
          onSelect: () => navigate('/boards'),
        },
      );
      return result;
    }

    for (const task of data?.tasks ?? []) {
      result.push({
        id: `task-${task.id}`,
        type: 'task',
        label: `${task.key} · ${task.title}`,
        hint: `${COLUMN_LABELS[task.columnKey]} · ${PRIORITY_LABELS[task.priority]}`,
        icon: <KanbanSquare className="size-4" />,
        onSelect: () => {
          rememberRecent({ type: 'task', key: task.key, title: task.title });
          navigate(`/tasks/${task.key}`);
        },
      });
    }

    for (const board of data?.boards ?? []) {
      result.push({
        id: `board-${board.id}`,
        type: 'board',
        label: board.name,
        hint: board.key,
        icon: (
          <span
            className="size-3 rounded-sm"
            style={{ backgroundColor: board.color }}
            aria-hidden
          />
        ),
        onSelect: () => {
          rememberRecent({
            type: 'board',
            key: board.key,
            title: board.name,
            color: board.color,
          });
          navigate(`/boards/${board.key}`);
        },
      });
    }

    for (const user of data?.users ?? []) {
      result.push({
        id: `user-${user.id}`,
        type: 'user',
        label: user.displayName,
        hint: user.tgUsername ? `@${user.tgUsername}` : undefined,
        icon: <UserAvatar user={user} size="xs" />,
        onSelect: () => navigate('/boards'),
      });
    }

    return result;
  }, [data, debounced, navigate, recent]);

  React.useEffect(() => {
    setActiveIndex(0);
    itemRefs.current[0]?.scrollIntoView({ block: 'nearest' });
  }, [items]);

  React.useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  React.useEffect(() => {
    if (open) {
      // Читаем при открытии: список мог пополниться, пока палитра закрыта.
      setRecent(readRecent());
      return;
    }
    setQuery('');
  }, [open]);

  const select = (index: number): void => {
    const item = items[index];
    if (!item) return;
    item.onSelect();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        size="md"
        hideClose
        className="h-72 overflow-hidden p-0 max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-[calc(100vw-1.5rem)]"
        forceDialog
      >
        <DialogTitle className="sr-only">Поиск задач, досок и людей</DialogTitle>
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4 transition-colors focus-within:bg-secondary/20">
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % Math.max(items.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + items.length) % Math.max(items.length, 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                select(activeIndex);
              }
            }}
            placeholder="Задача, доска, человек или ключ…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
            autoFocus
            // eslint-disable-next-line jsx-a11y/no-autofocus
            aria-label="Поиск"
          />
          {isFetching && <Spinner />}
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
              aria-label="Очистить поиск"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="flex h-full items-center justify-center px-3 py-10 text-center text-sm text-muted-foreground">
              {debounced.length < 2 ? 'Введите минимум 2 символа' : 'Ничего не найдено'}
            </p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(index)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/25',
                  index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60',
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {item.hint}
                  </span>
                )}
                {index === activeIndex && (
                  <CornerDownLeft className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
          <span>↑↓ — выбор</span>
          <span>↵ — открыть</span>
          <span>Esc — закрыть</span>
          {!debounced && recent.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearRecent();
                setRecent([]);
              }}
              className="ml-auto rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
            >
              Очистить недавнее
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
