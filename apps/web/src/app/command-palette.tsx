import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, KanbanSquare, LayoutGrid, ListTodo, Search } from 'lucide-react';
import { COLUMN_LABELS, PRIORITY_LABELS } from '@kaif/shared';
import { useSearch } from '@/api/search';
import { useUiStore } from '@/stores/ui';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
  const debounced = useDebounce(query, 220);
  const { data, isFetching } = useSearch(debounced);
  const [activeIndex, setActiveIndex] = React.useState(0);

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
        onSelect: () => navigate(`/tasks/${task.key}`),
      });
    }

    for (const board of data?.boards ?? []) {
      result.push({
        id: `board-${board.id}`,
        type: 'board',
        label: board.name,
        hint: board.key,
        icon: (
          <span className="size-3 rounded-sm" style={{ backgroundColor: board.color }} aria-hidden />
        ),
        onSelect: () => navigate(`/boards/${board.key}`),
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
  }, [data, debounced, navigate]);

  React.useEffect(() => setActiveIndex(0), [items.length]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const select = (index: number): void => {
    const item = items[index];
    if (!item) return;
    item.onSelect();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md" hideClose className="overflow-hidden p-0" forceDialog>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
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
            placeholder="Задача, доска или человек… (можно ввести ключ OPS-12)"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
            // eslint-disable-next-line jsx-a11y/no-autofocus
            aria-label="Поиск"
          />
          {isFetching && <Spinner />}
        </div>

        <div className="scrollbar-thin max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {debounced.length < 2 ? 'Введите минимум 2 символа' : 'Ничего не найдено'}
            </p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/60',
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                )}
                {index === activeIndex && (
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ — выбор</span>
          <span>↵ — открыть</span>
          <span>Esc — закрыть</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
