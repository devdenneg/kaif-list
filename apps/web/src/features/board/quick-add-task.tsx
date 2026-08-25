import * as React from 'react';
import type { ColumnKey, TaskPriority, TaskType } from '@kaif/shared';
import { useCreateTask } from '@/api/tasks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/lib/toast';

/**
 * Чем заполнить задачу, созданную в конкретном месте доски.
 *
 * Сейчас это признак дорожки при группировке: исполнитель, приоритет
 * или тип — смотря по чему сгруппировано.
 */
export interface TaskDefaults {
  assigneeId?: string;
  priority?: TaskPriority;
  type?: TaskType;
}

/**
 * Быстрое создание задачи прямо в колонке.
 * Enter — создать, Shift+Enter — перенос строки, Esc — отмена.
 * Форма остаётся открытой, чтобы можно было накидать сразу несколько задач.
 */
export function QuickAddTask({
  boardId,
  columnKey,
  defaults,
  onClose,
}: {
  boardId: string;
  columnKey: ColumnKey;
  defaults?: TaskDefaults;
  onClose: () => void;
}): React.ReactElement {
  const [title, setTitle] = React.useState('');
  const createTask = useCreateTask(boardId);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      toast.warning('Слишком короткий заголовок', 'Минимум 3 символа');
      return;
    }
    try {
      await createTask.mutateAsync({
        title: trimmed,
        columnKey,
        type: defaults?.type ?? 'TASK',
        priority: defaults?.priority ?? 'MEDIUM',
        isBacklog: false,
        ...(defaults?.assigneeId ? { assigneeId: defaults.assigneeId } : {}),
      });
      setTitle('');
      inputRef.current?.focus();
    } catch (error) {
      toast.error('Не удалось создать задачу', error);
    }
  };

  return (
    <div className="animate-slide-up rounded-lg border border-primary/40 bg-card p-2 shadow-card motion-reduce:animate-none">
      <Textarea
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
          if (event.key === 'Escape') onClose();
        }}
        placeholder="Что нужно сделать?"
        rows={2}
        className="min-h-16 resize-none border-0 bg-transparent px-1 py-1.5 leading-6 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void submit()}
          loading={createTask.isPending}
        >
          Добавить
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">Enter — создать</span>
      </div>
    </div>
  );
}
