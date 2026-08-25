import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { COLUMN_ORDER, type BoardDto, type ColumnKey, type TaskCardDto } from '@kaif/shared';
import { NO_COLLAPSED_COLUMNS, useUiStore } from '@/stores/ui';
import { haptic } from '@/lib/utils';
import { TaskCard } from './task-card';
import { BoardColumn } from './board-column';
import type { BoardColumns } from '@/api/tasks';

export interface MoveRequest {
  taskId: string;
  toColumn: ColumnKey;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
}

export interface KanbanBoardProps {
  board: BoardDto;
  columns: BoardColumns;
  onOpenTask: (task: TaskCardDto) => void;
  onMove: (request: MoveRequest) => void;
  canDrag: boolean;
  canCreate: boolean;
  timeZone?: string;
  mobile?: boolean;
}

/**
 * Канбан с перетаскиванием.
 *
 * Во время перетаскивания состояние колонок держим локально: так карточка
 * визуально «переезжает» между колонками сразу, а запрос уходит один раз —
 * в момент отпускания. Ответ сервера потом синхронизирует всё окончательно.
 */
export function KanbanBoard({
  board,
  columns,
  onOpenTask,
  onMove,
  canDrag,
  canCreate,
  timeZone,
  mobile,
}: KanbanBoardProps): React.ReactElement {
  // Фолбэк вынесен за пределы селектора: возвращать из него новый литерал
  // нельзя — см. комментарий к NO_COLLAPSED_COLUMNS.
  const collapsedColumns =
    useUiStore((state) => state.collapsedColumns[board.id]) ?? NO_COLLAPSED_COLUMNS;
  const toggleColumn = useUiStore((state) => state.toggleColumn);

  const [local, setLocal] = React.useState<BoardColumns>(columns);
  const [activeTask, setActiveTask] = React.useState<TaskCardDto | null>(null);

  // Пока карточку держат — внешние обновления не применяем, иначе она «прыгает».
  React.useEffect(() => {
    if (!activeTask) setLocal(columns);
  }, [columns, activeTask]);

  const sensors = useSensors(
    // Небольшой сдвиг мышью, иначе обычный клик по карточке считался бы перетаскиванием.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // На телефоне — долгий тап: иначе доска не прокручивается пальцем.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumnOfTask = React.useCallback(
    (taskId: string, source: BoardColumns): ColumnKey | null => {
      for (const column of COLUMN_ORDER) {
        if ((source[column] ?? []).some((task) => task.id === taskId)) return column;
      }
      return null;
    },
    [],
  );

  const resolveColumn = React.useCallback(
    (id: string, source: BoardColumns): ColumnKey | null => {
      if (id.startsWith('column:')) return id.slice('column:'.length) as ColumnKey;
      return findColumnOfTask(id, source);
    },
    [findColumnOfTask],
  );

  const handleDragStart = (event: DragStartEvent): void => {
    const task = event.active.data.current?.task as TaskCardDto | undefined;
    if (task) {
      setActiveTask(task);
      haptic(10);
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setLocal((current) => {
      const fromColumn = findColumnOfTask(activeId, current);
      const toColumn = resolveColumn(overId, current);
      if (!fromColumn || !toColumn || fromColumn === toColumn) return current;

      const fromList = [...(current[fromColumn] ?? [])];
      const index = fromList.findIndex((task) => task.id === activeId);
      if (index < 0) return current;

      const [moved] = fromList.splice(index, 1);
      if (!moved) return current;

      const toList = [...(current[toColumn] ?? [])];
      const overIndex = toList.findIndex((task) => task.id === overId);
      const insertAt = overIndex >= 0 ? overIndex : toList.length;
      toList.splice(insertAt, 0, { ...moved, columnKey: toColumn });

      return { ...current, [fromColumn]: fromList, [toColumn]: toList };
    });
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    const task = activeTask;
    setActiveTask(null);
    if (!over || !task) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const toColumn = resolveColumn(overId, local) ?? findColumnOfTask(activeId, local);
    if (!toColumn) return;

    const list = [...(local[toColumn] ?? [])];
    let index = list.findIndex((item) => item.id === activeId);

    // Перестановка внутри колонки: сдвигаем на позицию карточки, над которой отпустили.
    if (!overId.startsWith('column:')) {
      const overIndex = list.findIndex((item) => item.id === overId);
      if (index >= 0 && overIndex >= 0 && index !== overIndex) {
        const [moved] = list.splice(index, 1);
        if (moved) list.splice(overIndex, 0, moved);
        index = overIndex;
        setLocal((current) => ({ ...current, [toColumn]: list }));
      }
    }

    if (index < 0) index = list.length - 1;

    const before = list[index + 1]?.id ?? null;
    const after = list[index - 1]?.id ?? null;

    const originalColumn = findColumnOfTask(activeId, columns);
    const originalIndex = (columns[toColumn] ?? []).findIndex((item) => item.id === activeId);
    const positionUnchanged = originalColumn === toColumn && originalIndex === index;
    if (positionUnchanged) return;

    haptic([8, 20, 8]);
    onMove({ taskId: activeId, toColumn, beforeTaskId: before, afterTaskId: after });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      modifiers={[restrictToWindowEdges]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveTask(null);
        setLocal(columns);
      }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Взята карточка ${String(active.id)}`,
          onDragOver: () => 'Перемещение',
          onDragEnd: () => 'Карточка перемещена',
          onDragCancel: () => 'Перемещение отменено',
        },
      }}
    >
      <div
        className={
          mobile
            ? 'snap-columns flex gap-3 overflow-x-auto px-3 pb-4'
            : 'scrollbar-thin flex gap-3 overflow-x-auto px-4 pb-4'
        }
      >
        {COLUMN_ORDER.map((columnKey) => {
          const meta = board.columns.find((column) => column.key === columnKey);
          return (
            <BoardColumn
              key={columnKey}
              boardId={board.id}
              columnKey={columnKey}
              name={meta?.name ?? ''}
              tasks={local[columnKey] ?? []}
              wipLimit={meta?.wipLimit ?? null}
              collapsed={!mobile && collapsedColumns.includes(columnKey)}
              onToggleCollapse={() => toggleColumn(board.id, columnKey)}
              onOpenTask={onOpenTask}
              canCreate={canCreate}
              canDrag={canDrag}
              {...(timeZone ? { timeZone } : {})}
              {...(mobile ? { mobile: true } : {})}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTask ? (
          <TaskCard task={activeTask} isOverlay {...(timeZone ? { timeZone } : {})} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
