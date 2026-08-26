import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Archive, Inbox, Star } from 'lucide-react';
import type { BoardSummaryDto } from '@kaif/shared';
import { BOARD_ROLE_LABELS } from '@kaif/shared';
import { useToggleFavorite } from '@/api/boards';
import { AvatarGroup } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function BoardCard({ board }: { board: BoardSummaryDto }): React.ReactElement {
  const toggleFavorite = useToggleFavorite(board.id);
  const progress = board.counts.tasks > 0 ? (board.counts.done / board.counts.tasks) * 100 : 0;

  return (
    <Link
      to={`/boards/${board.key}`}
      className="glass-card group relative flex flex-col gap-3 rounded-xl border border-border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover"
    >
      <span
        className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
        style={{ backgroundColor: board.color }}
        aria-hidden
      />

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold leading-tight">{board.name}</h3>
            {board.isArchived && (
              <Badge variant="outline">
                <Archive />В архиве
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {board.key} · {BOARD_ROLE_LABELS[board.myRole]}
          </p>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleFavorite.mutate(!board.isFavorite);
          }}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary"
          aria-label={board.isFavorite ? 'Убрать из избранного' : 'В избранное'}
        >
          <Star
            className={cn('size-4', board.isFavorite && 'fill-warning text-warning')}
          />
        </button>
      </div>

      {board.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{board.description}</p>
      )}

      <div className="mt-auto space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {board.counts.done} из {board.counts.tasks} готово
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} indicatorClassName="bg-success" />

        <div className="flex items-center justify-between gap-2 pt-1">
          <AvatarGroup users={board.memberPreview} size="sm" max={4} />
          <div className="flex items-center gap-1.5">
            {board.counts.backlog > 0 && (
              <Badge variant="outline" title="В бэклоге">
                <Inbox />
                {board.counts.backlog}
              </Badge>
            )}
            {board.counts.overdue > 0 && (
              <Badge variant="danger" title="Просрочено">
                <AlertTriangle />
                {board.counts.overdue}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
