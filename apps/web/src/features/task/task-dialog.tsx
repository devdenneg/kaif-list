import * as React from 'react';
import { useTask } from '@/api/tasks';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { useTaskRealtime } from './use-task-realtime';
import { TaskDetail } from './task-detail';
import { toast } from '@/lib/toast';

/** Задача поверх доски. Ключ задачи живёт в query-параметре, поэтому ссылку можно скопировать. */
export function TaskDialog({
  taskKey,
  boardId,
  onClose,
}: {
  taskKey: string;
  boardId: string;
  onClose: () => void;
}): React.ReactElement {
  const { data: task, isLoading, error } = useTask(taskKey);

  const viewers = useTaskRealtime(task?.id, boardId, {
    onDeleted: () => {
      toast.warning('Задачу удалили', 'Её только что удалил другой участник');
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="full"
        hideClose
        className="h-[92vh] max-h-[92vh] p-0 sm:h-[88vh]"
      >
        {isLoading ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error || !task ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Задача не найдена или у вас нет доступа.
          </div>
        ) : (
          <TaskDetail task={task} onClose={onClose} viewers={viewers} />
        )}
      </DialogContent>
    </Dialog>
  );
}
