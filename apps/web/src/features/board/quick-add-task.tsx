import * as React from 'react';
import type { ColumnKey } from '@kaif/shared';
import { useCreateTask } from '@/api/tasks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/lib/toast';

/**
 * Быстрое создание задачи прямо в колонке.
 * Enter — создать, Shift+Enter — перенос строки, Esc — отмена.
 * Форма остаётся открытой, чтобы можно было накидать сразу несколько задач.
 */
export function QuickAddTask({
  boardId,
  columnKey,
  onClose,
}: {
  boardId: string;
  columnKey: ColumnKey;
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
        type: 'TASK',
        priority: 'MEDIUM',
        isBacklog: false,
      });
      setTitle('');
      inputRef.current?.focus();
    } catch (error) {
      toast.error('Не удалось создать задачу', error);
    }
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-card p-2 shadow-card">
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
        className="min-h-[56px] resize-none border-0 p-0 shadow-none focus-visible:ring-0"
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
