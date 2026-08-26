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
  const activeRef = React.useRef<ColumnKey>('TODO');
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const tabRefs = React.useRef<Partial<Record<ColumnKey, HTMLButtonElement | null>>>({});

  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  React.useEffect(() => {
    const firstColumn = document.getElementById(`column-${COLUMN_ORDER[0]}`);
    const scrollContainer = firstColumn?.parentElement ?? null;
    if (!scrollContainer) return undefined;

    let scrollFrame = 0;
    let resizeFrame = 0;
    let releaseFrame = 0;
    let aligningAfterResize = false;

    const updateActiveFromScroll = (): void => {
      if (aligningAfterResize) return;
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const pageWidth = scrollContainer.clientWidth;
        if (pageWidth <= 0) return;
        const index = Math.max(
          0,
          Math.min(COLUMN_ORDER.length - 1, Math.round(scrollContainer.scrollLeft / pageWidth)),
        );
        const next = COLUMN_ORDER[index];
        if (!next || next === activeRef.current) return;
        activeRef.current = next;
        setActive(next);
      });
    };

    const alignActiveColumn = (): void => {
      cancelAnimationFrame(resizeFrame);
      aligningAfterResize = true;
      resizeFrame = requestAnimationFrame(() => {
        const index = COLUMN_ORDER.indexOf(activeRef.current);
        scrollContainer.scrollTo({
          left: Math.max(0, index) * scrollContainer.clientWidth,
          behavior: 'auto',
        });
        releaseFrame = requestAnimationFrame(() => {
          aligningAfterResize = false;
          updateActiveFromScroll();
        });
      });
    };

    scrollContainer.addEventListener('scroll', updateActiveFromScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(alignActiveColumn);
    resizeObserver?.observe(scrollContainer);
    if (!resizeObserver) window.addEventListener('resize', alignActiveColumn);
    updateActiveFromScroll();

    return () => {
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(releaseFrame);
      scrollContainer.removeEventListener('scroll', updateActiveFromScroll);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', alignActiveColumn);
    };
  }, [columns]);

  React.useEffect(() => {
    const container = tabsRef.current;
    const tab = tabRefs.current[active];
    if (!container || !tab) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const nextLeft =
      container.scrollLeft +
      tabRect.left -
      containerRect.left -
      (container.clientWidth - tabRect.width) / 2;
    container.scrollTo({
      left: Math.max(0, nextLeft),
      behavior: 'smooth',
    });
  }, [active]);

  const scrollTo = (key: ColumnKey): void => {
    const column = document.getElementById(`column-${key}`);
    const scrollContainer = column?.parentElement;
    if (!column || !scrollContainer) return;

    activeRef.current = key;
    setActive(key);
    scrollContainer.scrollTo({
      left: COLUMN_ORDER.indexOf(key) * scrollContainer.clientWidth,
      behavior: 'smooth',
    });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent, key: ColumnKey): void => {
    const currentIndex = COLUMN_ORDER.indexOf(key);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = Math.min(COLUMN_ORDER.length - 1, currentIndex + 1);
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = COLUMN_ORDER.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = COLUMN_ORDER[nextIndex];
    if (!next) return;
    scrollTo(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={tabsRef}
      className="scrollbar-thin flex w-full min-w-0 max-w-full shrink-0 gap-1 overflow-x-auto overscroll-x-contain pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
      role="tablist"
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
            id={`mobile-column-tab-${key}`}
            type="button"
            onClick={() => scrollTo(key)}
            onKeyDown={(event) => handleTabKeyDown(event, key)}
            role="tab"
            aria-selected={active === key}
            aria-controls={`column-${key}`}
            tabIndex={active === key ? 0 : -1}
            aria-label={`${COLUMN_SHORT_LABELS[key]}: ${count}`}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
              active === key
                ? 'border-primary/45 bg-primary/10 text-primary shadow-[inset_0_1px_0_hsl(var(--primary)/0.12)]'
                : 'border-border bg-surface text-muted-foreground dark:border-white/10 dark:bg-surface/55',
            )}
          >
            {COLUMN_SHORT_LABELS[key]}
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px]',
                active === key ? 'bg-primary/15 text-primary' : 'bg-secondary',
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
