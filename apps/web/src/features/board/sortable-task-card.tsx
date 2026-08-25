import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ColumnKey, TaskCardDto } from '@kaif/shared';
import { TaskCard } from './task-card';

export function SortableTaskCard({
  task,
  columnKey,
  onOpen,
  timeZone,
  disabled,
}: {
  task: TaskCardDto;
  columnKey: ColumnKey;
  onOpen: (task: TaskCardDto) => void;
  timeZone?: string;
  disabled?: boolean;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnKey, task },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      className="touch-none"
    >
      <TaskCard task={task} onOpen={onOpen} isDragging={isDragging} {...(timeZone ? { timeZone } : {})} />
    </div>
  );
}
