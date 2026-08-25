import * as React from 'react';
import { Filter, Search, X } from 'lucide-react';
import {
  PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskType,
  type BoardDto,
} from '@kaif/shared';
import { EMPTY_FILTERS, hasActiveFilters, useUiStore, type BoardFilters as Filters } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, LabelChip } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/misc';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DUE_OPTIONS: { value: Filters['due']; label: string }[] = [
  { value: 'any', label: 'Любой срок' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'На этой неделе' },
  { value: 'has', label: 'Есть срок' },
  { value: 'none', label: 'Без срока' },
];

/** Панель фильтров доски. Состояние живёт в сторе и переживает перезагрузку. */
export function BoardFilters({ board }: { board: BoardDto }): React.ReactElement {
  const filters = useUiStore((state) => state.filters[board.id]) ?? EMPTY_FILTERS;
  const setFilters = useUiStore((state) => state.setFilters);
  const resetFilters = useUiStore((state) => state.resetFilters);

  const active = hasActiveFilters(filters);
  const activeCount =
    filters.assigneeIds.length +
    filters.groupIds.length +
    filters.labelIds.length +
    filters.priorities.length +
    filters.types.length +
    (filters.due !== 'any' ? 1 : 0) +
    (filters.unassigned ? 1 : 0) +
    (filters.includeArchived ? 1 : 0);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.search}
        onChange={(event) => setFilters(board.id, { search: event.target.value })}
        placeholder="Поиск по доске"
        icon={<Search />}
        className="h-8 w-full sm:w-52"
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant={activeCount > 0 ? 'primary' : 'outline'} size="sm">
            <Filter />
            Фильтры
            {activeCount > 0 && (
              <span className="rounded bg-primary-foreground/20 px-1 text-[10px] font-semibold">
                {activeCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80 p-0" align="start">
          <div className="scrollbar-thin max-h-[70vh] space-y-4 overflow-y-auto p-3">
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Исполнитель
              </p>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-secondary">
                <Checkbox
                  checked={filters.unassigned}
                  onCheckedChange={(value) =>
                    setFilters(board.id, { unassigned: value === true })
                  }
                />
                Без исполнителя
              </label>
              <div className="scrollbar-thin max-h-40 overflow-y-auto">
                {board.members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-secondary"
                  >
                    <Checkbox
                      checked={filters.assigneeIds.includes(member.userId)}
                      onCheckedChange={() =>
                        setFilters(board.id, {
                          assigneeIds: toggle(filters.assigneeIds, member.userId),
                        })
                      }
                    />
                    <UserAvatar user={member.user} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{member.user.displayName}</span>
                  </label>
                ))}
              </div>
            </section>

            {board.groups.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Группы
                </p>
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  Показываем задачи всех, кто входит в выбранные группы.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {board.groups.map((group) => {
                    const selected = filters.groupIds.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() =>
                          setFilters(board.id, { groupIds: toggle(filters.groupIds, group.id) })
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                          selected
                            ? 'text-accent-foreground'
                            : 'border-border text-muted-foreground hover:bg-secondary',
                        )}
                        style={
                          selected
                            ? { borderColor: group.color, backgroundColor: `${group.color}1f` }
                            : undefined
                        }
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: group.color }}
                          aria-hidden
                        />
                        {group.name}
                        <span className="opacity-60">{group.members.length}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {board.labels.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Метки
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {board.labels.map((label) => {
                    const selected = filters.labelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() =>
                          setFilters(board.id, { labelIds: toggle(filters.labelIds, label.id) })
                        }
                        className={cn(
                          'rounded transition-all',
                          selected && 'ring-2 ring-ring ring-offset-1 ring-offset-popover',
                        )}
                      >
                        <LabelChip name={label.name} color={label.color} />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Приоритет
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(TaskPriority).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    onClick={() =>
                      setFilters(board.id, { priorities: toggle(filters.priorities, priority) })
                    }
                  >
                    <Badge variant={filters.priorities.includes(priority) ? 'primary' : 'outline'}>
                      {PRIORITY_LABELS[priority]}
                    </Badge>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Тип
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(TaskType).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilters(board.id, { types: toggle(filters.types, type) })}
                  >
                    <Badge variant={filters.types.includes(type) ? 'primary' : 'outline'}>
                      {TASK_TYPE_LABELS[type]}
                    </Badge>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-secondary">
                <Checkbox
                  checked={filters.includeArchived}
                  onCheckedChange={(value) =>
                    setFilters(board.id, { includeArchived: value === true })
                  }
                />
                Показывать задачи из архива
              </label>
            </section>

            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Срок
              </p>
              <Select
                value={filters.due}
                onValueChange={(value) => setFilters(board.id, { due: value as Filters['due'] })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          </div>

          {active && (
            <div className="border-t border-border p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => resetFilters(board.id)}
              >
                <X />
                Сбросить фильтры
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {active && (
        <Button variant="ghost" size="sm" onClick={() => resetFilters(board.id)}>
          <X />
          Сбросить
        </Button>
      )}
    </div>
  );
}
