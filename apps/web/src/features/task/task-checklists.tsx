import * as React from 'react';
import { ListChecks, Plus, Trash2, X } from 'lucide-react';
import type { TaskDetailDto } from '@kaif/shared';
import { useChecklistMutations } from '@/api/tasks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox, Progress } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/** Чек-листы = подзадачи. Прогресс сразу виден на карточке доски. */
export function TaskChecklists({
  task,
  editable,
}: {
  task: TaskDetailDto;
  editable: boolean;
}): React.ReactElement {
  const mutations = useChecklistMutations(task.id, task.boardId);
  const [addingList, setAddingList] = React.useState(false);
  const [listTitle, setListTitle] = React.useState('');

  const total = task.checklistTotal;
  const done = task.checklistDone;

  return (
    <section className="space-y-2.5">
      <div className="flex min-h-9 items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Чек-листы</h3>
        {total > 0 && (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {done} из {total}
          </span>
        )}
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto -mr-2 [@media(pointer:coarse)]:min-h-11"
            onClick={() => setAddingList(true)}
          >
            <Plus />
            Добавить
          </Button>
        )}
      </div>

      {total > 0 && (
        <Progress
          value={(done / total) * 100}
          indicatorClassName={done === total ? 'bg-success' : undefined}
        />
      )}

      {addingList && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <Input
            value={listTitle}
            onChange={(event) => setListTitle(event.target.value)}
            placeholder="Название чек-листа"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && listTitle.trim()) {
                mutations.createChecklist.mutate(listTitle.trim(), {
                  onSuccess: () => {
                    setListTitle('');
                    setAddingList(false);
                  },
                  onError: (error) => toast.error('Не удалось создать чек-лист', error),
                });
              }
              if (event.key === 'Escape') setAddingList(false);
            }}
          />
          <Button
            variant="primary"
            className="[@media(pointer:coarse)]:min-h-11"
            onClick={() =>
              listTitle.trim() &&
              mutations.createChecklist.mutate(listTitle.trim(), {
                onSuccess: () => {
                  setListTitle('');
                  setAddingList(false);
                },
              })
            }
            loading={mutations.createChecklist.isPending}
          >
            Создать
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="[@media(pointer:coarse)]:size-11"
            onClick={() => setAddingList(false)}
            aria-label="Отменить добавление чек-листа"
          >
            <X />
          </Button>
        </div>
      )}

      {task.checklists.map((checklist) => (
        <div key={checklist.id} className="rounded-lg border border-border p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="min-w-0 flex-1 break-words text-sm font-medium">{checklist.title}</h4>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {checklist.items.filter((item) => item.done).length}/{checklist.items.length}
            </span>
            {editable && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto text-muted-foreground [@media(pointer:coarse)]:size-10"
                onClick={() => mutations.deleteChecklist.mutate(checklist.id)}
                aria-label="Удалить чек-лист"
              >
                <Trash2 />
              </Button>
            )}
          </div>

          <div className="space-y-1">
            {checklist.items.map((item) => (
              <label
                key={item.id}
                className="group flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-secondary/60 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center"
              >
                <Checkbox
                  className="mt-0.5 [@media(pointer:coarse)]:mt-0"
                  checked={item.done}
                  disabled={!editable}
                  onCheckedChange={(value) =>
                    mutations.updateItem.mutate({ itemId: item.id, done: value === true })
                  }
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words',
                    item.done && 'text-muted-foreground line-through',
                  )}
                >
                  {item.text}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => mutations.deleteItem.mutate(item.id)}
                    className="shrink-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:opacity-100"
                    aria-label="Удалить пункт"
                  >
                    <X className="size-3.5 text-muted-foreground" />
                  </button>
                )}
              </label>
            ))}
          </div>

          {editable && <AddChecklistItem checklistId={checklist.id} mutations={mutations} />}
        </div>
      ))}

      {task.checklists.length === 0 && !addingList && (
        <p className="rounded-lg bg-background/25 px-3 py-2.5 text-sm leading-5 text-muted-foreground">
          Шагов пока нет. Разбейте задачу на части, чтобы видеть прогресс.
        </p>
      )}
    </section>
  );
}

function AddChecklistItem({
  checklistId,
  mutations,
}: {
  checklistId: string;
  mutations: ReturnType<typeof useChecklistMutations>;
}): React.ReactElement {
  const [text, setText] = React.useState('');

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    mutations.addItem.mutate(
      { checklistId, text: value },
      {
        onSuccess: () => setText(''),
        onError: (error) => toast.error('Не удалось добавить пункт', error),
      },
    );
  };

  return (
    <div className="mt-2 flex gap-1.5">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Добавить пункт…"
        className="h-8 [@media(pointer:coarse)]:h-11"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        onClick={submit}
        disabled={!text.trim()}
        aria-label="Добавить пункт"
      >
        <Plus />
      </Button>
    </div>
  );
}
