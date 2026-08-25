import * as React from 'react';
import { Check, Link2, Loader2, Search } from 'lucide-react';
import {
  COLUMN_LABELS,
  ColumnKey,
  TASK_LINK_LABELS,
  TaskLinkType,
  type TaskDetailDto,
} from '@kaif/shared';
import { useSearch } from '@/api/search';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import { TaskTypeIcon } from './task-visuals';
import { cn } from '@/lib/utils';

/**
 * Выбор задачи для связи.
 *
 * Раньше здесь надо было знать ключ наизусть и вписать его руками — а люди
 * помнят задачи по названию, а не по номеру. Теперь то же поле ищет по
 * названию и по ключу, показывает статус найденного и связывает одним
 * нажатием. Ключ по-прежнему работает: вставил «OPS-12» — он и найдётся.
 */

const TYPE_HINTS: Record<TaskLinkType, string> = {
  [TaskLinkType.BLOCKED_BY]: 'Эту задачу нельзя делать, пока не закрыта выбранная',
  [TaskLinkType.BLOCKS]: 'Выбранную нельзя делать, пока не закрыта эта',
  [TaskLinkType.RELATES]: 'Просто связаны по смыслу',
  [TaskLinkType.DUPLICATES]: 'Эта повторяет выбранную',
  [TaskLinkType.DUPLICATED_BY]: 'Выбранная повторяет эту',
};

/** Блокировки идут первыми: ради них связи чаще всего и заводят. */
const TYPE_ORDER: TaskLinkType[] = [
  TaskLinkType.BLOCKED_BY,
  TaskLinkType.BLOCKS,
  TaskLinkType.RELATES,
  TaskLinkType.DUPLICATES,
  TaskLinkType.DUPLICATED_BY,
];

export function TaskLinkPicker({
  task,
  onSubmit,
  loading,
}: {
  task: TaskDetailDto;
  onSubmit: (type: TaskLinkType, targetKey: string) => void;
  loading: boolean;
}): React.ReactElement {
  const [type, setType] = React.useState<TaskLinkType>(TaskLinkType.BLOCKED_BY);
  const [query, setQuery] = React.useState('');
  const debounced = useDebounce(query, 250);
  const { data, isFetching } = useSearch(debounced);

  // Себя и уже связанные задачи предлагать незачем.
  const excluded = new Set([task.id, ...task.links.map((link) => link.task.id)]);
  const found = (data?.tasks ?? []).filter((item) => !excluded.has(item.id));

  const looksLikeKey = /^[A-Za-z][A-Za-z0-9]{1,7}-\d{1,7}$/.test(query.trim());

  return (
    <div className="space-y-2">
      <div>
        <div className="grid grid-cols-1 gap-1">
          {TYPE_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              aria-pressed={type === item}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                type === item
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-secondary',
              )}
            >
              <Check className={cn('size-3.5 shrink-0', type !== item && 'invisible')} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{TASK_LINK_LABELS[item]}</span>
                <span className="ml-1.5 opacity-60">{TYPE_HINTS[item]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Название задачи или ключ"
        icon={isFetching ? <Loader2 className="animate-spin" /> : <Search />}
        autoFocus
        onKeyDown={(event) => {
          // Ключ можно просто вставить и нажать Enter — как раньше.
          if (event.key === 'Enter' && looksLikeKey) onSubmit(type, query.trim().toUpperCase());
        }}
      />

      <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
        {found.map((item) => {
          const done = item.columnKey === ColumnKey.DONE;
          return (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              onClick={() => onSubmit(type, item.key)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary disabled:opacity-60"
            >
              <TaskTypeIcon type={item.type} className="size-3.5 shrink-0" />
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {item.key}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted-foreground')}>
                {item.title}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                  done ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground',
                )}
              >
                {COLUMN_LABELS[item.columnKey]}
              </span>
            </button>
          );
        })}

        {debounced.trim().length >= 2 && found.length === 0 && !isFetching && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {looksLikeKey ? (
              <button
                type="button"
                onClick={() => onSubmit(type, query.trim().toUpperCase())}
                className="font-medium text-primary hover:underline"
              >
                Связать с {query.trim().toUpperCase()}
              </button>
            ) : (
              'Ничего не нашли'
            )}
          </p>
        )}

        {debounced.trim().length < 2 && (
          <p className="flex items-center justify-center gap-1.5 px-2 py-3 text-center text-xs text-muted-foreground">
            <Link2 className="size-3.5" />
            Начните вводить название или ключ
          </p>
        )}
      </div>
    </div>
  );
}
