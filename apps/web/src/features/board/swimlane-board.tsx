import * as React from 'react';
import { ChevronDown, ChevronRight, Minus } from 'lucide-react';
import {
  COLUMN_ORDER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  TASK_TYPE_LABELS,
  type BoardDto,
  type TaskCardDto,
} from '@kaif/shared';
import type { BoardColumns } from '@/api/tasks';
import type { Swimlane } from '@/stores/ui';
import { UserAvatar } from '@/components/ui/avatar';
import { KanbanBoard, type MoveRequest } from './kanban-board';
import { TaskTypeIcon, PriorityIcon } from '@/features/task/task-visuals';

/**
 * Доска, разбитая на дорожки.
 *
 * Дорожка — это срез по человеку, приоритету или типу. Полезно, когда на доске
 * несколько параллельных потоков работы и общий список перестаёт читаться.
 *
 * Перетаскивание работает внутри дорожки: карточка меняет колонку, но не
 * меняет то, по чему доска сгруппирована. Иначе один и тот же жест означал бы
 * два разных действия, и промахи стоили бы дорого — сменить исполнителя
 * или приоритет можно через меню карточки.
 */
export function SwimlaneBoard({
  board,
  columns,
  swimlane,
  onOpenTask,
  onMove,
  canDrag,
  canCreate,
  timeZone,
  mobile,
}: {
  board: BoardDto;
  columns: BoardColumns;
  swimlane: Exclude<Swimlane, 'none'>;
  onOpenTask: (task: TaskCardDto) => void;
  onMove: (request: MoveRequest) => void;
  canDrag: boolean;
  canCreate: boolean;
  timeZone?: string;
  mobile?: boolean;
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const lanes = React.useMemo(() => buildLanes(board, columns, swimlane), [board, columns, swimlane]);

  if (lanes.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        Под текущие фильтры не попало ни одной задачи.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {lanes.map((lane) => {
        const isCollapsed = collapsed.includes(lane.id);
        return (
          <section key={lane.id}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((current) =>
                  current.includes(lane.id)
                    ? current.filter((id) => id !== lane.id)
                    : [...current, lane.id],
                )
              }
              className="mb-2 flex w-full items-center gap-2 px-4 text-left"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              )}
              {lane.icon}
              <span className="truncate text-sm font-semibold">{lane.title}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {lane.total}
              </span>
              <span className="ml-2 h-px flex-1 bg-border" aria-hidden />
            </button>

            {!isCollapsed && (
              <KanbanBoard
                board={board}
                columns={lane.columns}
                onOpenTask={onOpenTask}
                onMove={onMove}
                canDrag={canDrag}
                canCreate={canCreate}
                {...(timeZone ? { timeZone } : {})}
                {...(mobile ? { mobile: true } : {})}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

interface Lane {
  id: string;
  title: string;
  icon: React.ReactNode;
  columns: BoardColumns;
  total: number;
}

const emptyColumns = (): BoardColumns => ({
  TODO: [],
  ON_HOLD: [],
  IN_PROGRESS: [],
  QA: [],
  READY_TO_RELEASE: [],
  DONE: [],
});

function buildLanes(board: BoardDto, columns: BoardColumns, swimlane: Exclude<Swimlane, 'none'>): Lane[] {
  const buckets = new Map<string, BoardColumns>();
  const ensure = (key: string): BoardColumns => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = emptyColumns();
    buckets.set(key, created);
    return created;
  };

  const keyOf = (task: TaskCardDto): string => {
    if (swimlane === 'assignee') return task.assignee?.id ?? '__none__';
    if (swimlane === 'priority') return task.priority;
    return task.type;
  };

  for (const column of COLUMN_ORDER) {
    for (const task of columns[column] ?? []) {
      ensure(keyOf(task))[column].push(task);
    }
  }

  const lanes: Lane[] = [];

  for (const [key, laneColumns] of buckets) {
    const total = COLUMN_ORDER.reduce((sum, column) => sum + laneColumns[column].length, 0);

    if (swimlane === 'assignee') {
      const member = board.members.find((item) => item.userId === key);
      lanes.push({
        id: key,
        title: member?.user.displayName ?? 'Без исполнителя',
        icon: member ? (
          <UserAvatar user={member.user} size="sm" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Minus className="size-3" />
          </span>
        ),
        columns: laneColumns,
        total,
      });
      continue;
    }

    if (swimlane === 'priority') {
      const priority = key as keyof typeof PRIORITY_LABELS;
      lanes.push({
        id: key,
        title: PRIORITY_LABELS[priority] ?? key,
        icon: <PriorityIcon priority={priority} />,
        columns: laneColumns,
        total,
      });
      continue;
    }

    const type = key as keyof typeof TASK_TYPE_LABELS;
    lanes.push({
      id: key,
      title: TASK_TYPE_LABELS[type] ?? key,
      icon: <TaskTypeIcon type={type} />,
      columns: laneColumns,
      total,
    });
  }

  // Порядок дорожек: сначала самое важное, «без исполнителя» — в конце.
  return lanes.sort((a, b) => {
    if (swimlane === 'priority') {
      return (
        (PRIORITY_ORDER[b.id as keyof typeof PRIORITY_ORDER] ?? 0) -
        (PRIORITY_ORDER[a.id as keyof typeof PRIORITY_ORDER] ?? 0)
      );
    }
    if (swimlane === 'assignee') {
      if (a.id === '__none__') return 1;
      if (b.id === '__none__') return -1;
    }
    return a.title.localeCompare(b.title, 'ru');
  });
}
