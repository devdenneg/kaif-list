import * as React from 'react';
import { LayoutGrid, Plus, Search } from 'lucide-react';
import { useBoards } from '@/api/boards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton, Switch } from '@/components/ui/misc';
import { BoardCard } from './board-card';
import { CreateBoardDialog } from './create-board-dialog';

export function BoardsPage(): React.ReactElement {
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const { data: boards, isLoading } = useBoards(includeArchived);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return boards ?? [];
    return (boards ?? []).filter(
      (board) =>
        board.name.toLowerCase().includes(needle) || board.key.toLowerCase().includes(needle),
    );
  }, [boards, search]);

  const favorites = filtered.filter((board) => board.isFavorite);
  const others = filtered.filter((board) => !board.isFavorite);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Доски</h1>
          <p className="text-sm text-muted-foreground">
            {boards ? `${boards.length} ${plural(boards.length, 'доска', 'доски', 'досок')}` : '—'}
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск досок"
            icon={<Search />}
            className="sm:w-56"
          />
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus />
            <span className="hidden sm:inline">Создать</span>
          </Button>
        </div>
      </header>

      <label className="mb-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
        Показывать архивные
      </label>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title={search ? 'Ничего не найдено' : 'Пока нет ни одной доски'}
          description={
            search
              ? 'Попробуйте изменить запрос'
              : 'Создайте первую доску — вы автоматически станете её владельцем.'
          }
          action={
            !search && (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus />
                Создать доску
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-8">
          {favorites.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Избранное
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.map((board) => (
                  <BoardCard key={board.id} board={board} />
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section>
              {favorites.length > 0 && (
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Остальные
                </h2>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((board) => (
                  <BoardCard key={board.id} board={board} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <CreateBoardDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
