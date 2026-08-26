import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTask } from '@/api/tasks';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useTaskRealtime } from './use-task-realtime';
import { TaskDetail } from './task-detail';
import { toast } from '@/lib/toast';

/**
 * Отдельная страница задачи.
 * Именно на неё ведут ссылки из Telegram — открывается сразу, без доски.
 */
export function TaskPage(): React.ReactElement {
  const { taskKey } = useParams<{ taskKey: string }>();
  const navigate = useNavigate();
  const { data: task, isLoading, error } = useTask(taskKey);

  const viewers = useTaskRealtime(task?.id, task?.boardId, {
    onDeleted: () => {
      toast.warning('Задачу удалили', 'Возвращаем вас на доску');
      if (task) navigate(`/boards/${task.board.key}`);
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-6">
        <EmptyState
          title="Задача не найдена"
          description="Возможно, её удалили или у вас нет доступа к этой доске."
          action={
            <Button variant="primary" onClick={() => navigate('/boards')}>
              К доскам
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="px-4 pt-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/boards/${task.board.key}`)}>
          <ArrowLeft />К доске «{task.board.name}»
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <TaskDetail task={task} viewers={viewers} />
        </div>
      </div>
    </div>
  );
}
