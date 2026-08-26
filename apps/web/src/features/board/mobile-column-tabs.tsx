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
  const tabRefs = React.useRef<Partial<Record<ColumnKey, HTMLButtonElement | null>>>({});

  React.useEffect(() => {
    const columnElements = COLUMN_ORDER.map((key) =>
      document.getElementById(`column-${key}`),
    ).filter((element): element is HTMLElement => element !== null);
    const scrollContainer = columnElements[0]?.parentElement ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const key = visible.target.id.replace('column-', '') as ColumnKey;
        if (COLUMN_ORDER.includes(key)) setActive(key);
      },
      { root: scrollContainer, threshold: [0.4, 0.6, 0.8] },
    );

    for (const element of columnElements) observer.observe(element);
    return () => observer.disconnect();
  }, [columns]);

  React.useEffect(() => {
    tabRefs.current[active]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [active]);

  const scrollTo = (key: ColumnKey): void => {
    const column = document.getElementById(`column-${key}`);
    const scrollContainer = column?.parentElement;
    if (!column || !scrollContainer) return;

    scrollContainer.scrollTo({
      left: Math.max(0, column.offsetLeft - scrollContainer.offsetLeft - 12),
      behavior: 'smooth',
    });
  };

  return (
    <div
      className="scrollbar-thin flex shrink-0 gap-1 overflow-x-auto px-3 pb-3"
      role="navigation"
      aria-label="Быстрый переход к колонке"
    >
      {COLUMN_ORDER.map((key) => {
        const count = (columns[key] ?? []).length;
        return (
          <button
            key={key}
            ref={(node) => {
              tabRefs.current[key] = node;
            }}
            type="button"
            onClick={() => scrollTo(key)}
            aria-pressed={active === key}
            aria-label={`${COLUMN_SHORT_LABELS[key]}: ${count}`}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
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
