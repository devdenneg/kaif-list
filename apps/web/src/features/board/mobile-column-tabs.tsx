import * as React from 'react';
import { COLUMN_ORDER, COLUMN_SHORT_LABELS, type ColumnKey } from '@kaif/shared';
import type { BoardColumns } from '@/api/tasks';
import { cn } from '@/lib/utils';

/**
 * Переключатель колонок для телефона.
 *
 * Колонки прокручиваются свайпом, но попасть в нужную свайпами долго —
 * поэтому сверху всегда есть строка с названиями и счётчиками.
 * Активная колонка определяется по позиции прокрутки.
 */
export function MobileColumnTabs({ columns }: { columns: BoardColumns }): React.ReactElement {
  const [active, setActive] = React.useState<ColumnKey>('TODO');

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const key = visible.target.id.replace('column-', '') as ColumnKey;
        if (COLUMN_ORDER.includes(key)) setActive(key);
      },
      { threshold: [0.4, 0.6, 0.8] },
    );

    for (const key of COLUMN_ORDER) {
      const element = document.getElementById(`column-${key}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [columns]);

  const scrollTo = (key: ColumnKey): void => {
    document
      .getElementById(`column-${key}`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  return (
    <div className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-2">
      {COLUMN_ORDER.map((key) => {
        const count = (columns[key] ?? []).length;
        return (
          <button
            key={key}
            type="button"
            onClick={() => scrollTo(key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              active === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-surface text-muted-foreground',
            )}
          >
            {COLUMN_SHORT_LABELS[key]}
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px]',
                active === key ? 'bg-primary-foreground/20' : 'bg-secondary',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
