import * as React from 'react';
import { AlertTriangle, Bookmark, BookmarkPlus, CalendarDays, Check, Trash2, User, UserX, X } from 'lucide-react';
import type { BoardDto, SavedViewFilters } from '@kaif/shared';
import { useCreateSavedView, useDeleteSavedView, useSavedViews } from '@/api/views';
import { useAuthStore } from '@/stores/auth';
import { EMPTY_FILTERS, hasActiveFilters, useUiStore } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Быстрые фильтры и сохранённые виды.
 *
 * Три сценария закрывают почти всю ежедневную работу: «что на мне»,
 * «что горит», «что никто не взял». Держать их за двумя кликами в поповере —
 * значит, что ими не будут пользоваться, поэтому они вынесены чипами.
 */
export function BoardQuickFilters({ board }: { board: BoardDto }): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const filters = useUiStore((state) => state.filters[board.id]) ?? EMPTY_FILTERS;
  const setFilters = useUiStore((state) => state.setFilters);
  const resetFilters = useUiStore((state) => state.resetFilters);

  const { data: views } = useSavedViews(board.id);
  const createView = useCreateSavedView(board.id);
  const deleteView = useDeleteSavedView(board.id);

  const [saveOpen, setSaveOpen] = React.useState(false);
  const [viewName, setViewName] = React.useState('');
  const [shared, setShared] = React.useState(false);

  const mineActive = Boolean(user && filters.assigneeIds.includes(user.id));
  const overdueActive = filters.due === 'overdue';
  const todayActive = filters.due === 'today';
  const unassignedActive = filters.unassigned;
  const active = hasActiveFilters(filters);

  const toggleMine = (): void => {
    if (!user) return;
    setFilters(board.id, {
      assigneeIds: mineActive ? filters.assigneeIds.filter((id) => id !== user.id) : [user.id],
    });
  };

  const applyView = (saved: SavedViewFilters): void => {
    resetFilters(board.id);
    setFilters(board.id, {
      search: saved.search ?? '',
      assigneeIds: saved.assigneeIds ?? [],
      labelIds: saved.labelIds ?? [],
      priorities: saved.priorities ?? [],
      types: saved.types ?? [],
      due: saved.due ?? 'any',
      unassigned: saved.unassigned ?? false,
    });
  };

  const currentAsSaved = (): SavedViewFilters => ({
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.assigneeIds.length > 0 ? { assigneeIds: filters.assigneeIds } : {}),
    ...(filters.labelIds.length > 0 ? { labelIds: filters.labelIds } : {}),
    ...(filters.priorities.length > 0 ? { priorities: filters.priorities } : {}),
    ...(filters.types.length > 0 ? { types: filters.types } : {}),
    ...(filters.due !== 'any' ? { due: filters.due } : {}),
    ...(filters.unassigned ? { unassigned: true } : {}),
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip active={mineActive} onClick={toggleMine} icon={<User />}>
        На мне
      </Chip>

      <Chip
        active={overdueActive}
        onClick={() => setFilters(board.id, { due: overdueActive ? 'any' : 'overdue' })}
        icon={<AlertTriangle />}
        tone="danger"
      >
        Просрочено
      </Chip>

      <Chip
        active={todayActive}
        onClick={() => setFilters(board.id, { due: todayActive ? 'any' : 'today' })}
        icon={<CalendarDays />}
        tone="warning"
      >
        Сегодня
      </Chip>

      <Chip
        active={unassignedActive}
        onClick={() => setFilters(board.id, { unassigned: !unassignedActive })}
        icon={<UserX />}
      >
        Свободные
      </Chip>

      {/* ── Сохранённые виды ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Bookmark />
            Виды
            {views && views.length > 0 && (
              <span className="rounded bg-secondary px-1 text-[10px]">{views.length}</span>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Сохранённые фильтры</DropdownMenuLabel>

          {(views ?? []).length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Настройте фильтры и сохраните их — потом переключение в один клик.
            </p>
          )}

          {(views ?? []).map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={(event) => {
                event.preventDefault();
                applyView(view.filters);
              }}
            >
              <Bookmark className={cn(view.isShared && 'text-primary')} />
              <span className="min-w-0 flex-1 truncate">{view.name}</span>
              {view.isOwn && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteView.mutate(view.id, {
                      onSuccess: () => toast.success('Фильтр удалён'),
                    });
                  }}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Удалить фильтр ${view.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}

          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setSaveOpen(true);
                }}
              >
                <BookmarkPlus />
                Сохранить текущие фильтры
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Сохранить фильтр</DialogTitle>
            <DialogDescription>
              Текущий набор фильтров можно будет применить одним кликом.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <Input
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              placeholder="Например: «Горит на этой неделе»"
              maxLength={40}
              autoFocus
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={shared} onCheckedChange={(value) => setShared(value === true)} />
              Виден всей доске
            </label>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              disabled={!viewName.trim()}
              loading={createView.isPending}
              onClick={() =>
                createView.mutate(
                  { name: viewName.trim(), filters: currentAsSaved(), isShared: shared },
                  {
                    onSuccess: () => {
                      toast.success('Фильтр сохранён');
                      setViewName('');
                      setShared(false);
                      setSaveOpen(false);
                    },
                    onError: (error) => toast.error('Не удалось сохранить', error),
                  },
                )
              }
            >
              <Check />
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => resetFilters(board.id)}
        >
          <X />
          Сбросить
        </Button>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  icon,
  tone = 'default',
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5',
        active
          ? tone === 'danger'
            ? 'border-destructive bg-destructive/10 text-destructive'
            : tone === 'warning'
              ? 'border-warning bg-warning/10 text-warning'
              : 'border-primary bg-accent text-accent-foreground'
          : 'border-border bg-surface text-muted-foreground hover:bg-secondary',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
