import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  LIMITS,
  PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskType,
  type BoardDto,
  type ColumnKey,
  type RichTextDoc,
} from '@kaif/shared';
import { useCreateTask } from '@/api/tasks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/misc';
import { RichTextEditor } from '@/components/rich-text/editor';
import { UserPicker } from './user-picker';
import { LabelPicker } from './label-picker';
import { PriorityIcon, TaskTypeIcon } from './task-visuals';
import { fromDateTimeLocal } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { ApiError } from '@/lib/api';

/** Шаблоны описания: заполненный баг-репорт экономит день переписки. */
const TEMPLATES: Record<string, string> = {
  BUG: 'Шаги воспроизведения:\n1. \n2. \n\nОжидаемый результат:\n\nФактический результат:\n\nОкружение (браузер, устройство):',
  STORY: 'Как пользователь, я хочу …, чтобы …\n\nКритерии приёмки:\n- \n- ',
};

export function CreateTaskDialog({
  board,
  open,
  onOpenChange,
  defaults,
}: {
  board: BoardDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: { assigneeId?: string; columnKey?: ColumnKey; isBacklog?: boolean };
}): React.ReactElement {
  const navigate = useNavigate();
  const createTask = useCreateTask(board.id);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState<RichTextDoc | null>(null);
  const [type, setType] = React.useState<TaskType>(TaskType.TASK);
  const [priority, setPriority] = React.useState<TaskPriority>(TaskPriority.MEDIUM);
  const [columnKey, setColumnKey] = React.useState<ColumnKey>(defaults?.columnKey ?? 'TODO');
  const [assigneeId, setAssigneeId] = React.useState<string | null>(defaults?.assigneeId ?? null);
  const [testerId, setTesterId] = React.useState<string | null>(null);
  const [labelIds, setLabelIds] = React.useState<string[]>([]);
  const [dueDate, setDueDate] = React.useState('');
  const [isBacklog, setIsBacklog] = React.useState(defaults?.isBacklog ?? false);
  const [openAfterCreate, setOpenAfterCreate] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [editorKey, setEditorKey] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription(null);
    setType(TaskType.TASK);
    setPriority(TaskPriority.MEDIUM);
    setColumnKey(defaults?.columnKey ?? 'TODO');
    setAssigneeId(defaults?.assigneeId ?? null);
    setTesterId(null);
    setLabelIds([]);
    setDueDate('');
    setIsBacklog(defaults?.isBacklog ?? false);
    setErrors({});
    setEditorKey((key) => key + 1);
  }, [open, defaults?.assigneeId, defaults?.columnKey, defaults?.isBacklog]);

  const applyTemplate = (nextType: TaskType): void => {
    setType(nextType);
    const template = TEMPLATES[nextType];
    if (!template || description) return;
    setDescription({
      type: 'doc',
      content: template.split('\n').map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
    });
    setEditorKey((key) => key + 1);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setErrors({});

    const trimmed = title.trim();
    if (trimmed.length < LIMITS.taskTitle.min) {
      setErrors({ title: `Минимум ${LIMITS.taskTitle.min} символа` });
      return;
    }

    try {
      const task = await createTask.mutateAsync({
        title: trimmed,
        description,
        type,
        priority,
        columnKey,
        isBacklog,
        assigneeId,
        testerId,
        labelIds,
        dueDate: dueDate ? fromDateTimeLocal(dueDate) : null,
      });

      toast.success(`Задача ${task.key} создана`);
      onOpenChange(false);
      if (openAfterCreate) navigate(`/tasks/${task.key}`);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      toast.error('Не удалось создать задачу', error);
    }
  };

  const assignee = board.members.find((member) => member.userId === assigneeId)?.user ?? null;
  const tester = board.members.find((member) => member.userId === testerId)?.user ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
            <DialogDescription>
              Доска «{board.name}» · вы станете автором задачи
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormField label="Заголовок" required error={errors.title}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Коротко и по делу: что нужно сделать"
                maxLength={LIMITS.taskTitle.max}
                invalid={Boolean(errors.title)}
                autoFocus
              />
            </FormField>

            <FormField label="Описание">
              <RichTextEditor
                key={editorKey}
                value={description}
                onChange={(value) => setDescription(value)}
                users={board.members.map((member) => member.user)}
                placeholder="Что нужно сделать, как проверить результат, что важно учесть"
                minHeight="140px"
                uploadTarget={{ boardId: board.id }}
              />
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Тип">
                <Select value={type} onValueChange={(value) => applyTemplate(value as TaskType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(TaskType).map((item) => (
                      <SelectItem key={item} value={item}>
                        <span className="flex items-center gap-2">
                          <TaskTypeIcon type={item} />
                          {TASK_TYPE_LABELS[item]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Приоритет">
                <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(TaskPriority).map((item) => (
                      <SelectItem key={item} value={item}>
                        <span className="flex items-center gap-2">
                          <PriorityIcon priority={item} />
                          {PRIORITY_LABELS[item]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Исполнитель">
                <UserPicker
                  members={board.members}
                  value={assignee}
                  onChange={setAssigneeId}
                  triggerClassName="border border-input h-9 bg-surface"
                />
              </FormField>

              <FormField label="Тестировщик">
                <UserPicker
                  members={board.members}
                  value={tester}
                  onChange={setTesterId}
                  triggerClassName="border border-input h-9 bg-surface"
                />
              </FormField>

              <FormField label="Колонка">
                <Select
                  value={columnKey}
                  onValueChange={(value) => setColumnKey(value as ColumnKey)}
                  disabled={isBacklog}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_ORDER.map((column) => (
                      <SelectItem key={column} value={column}>
                        {board.columns.find((item) => item.key === column)?.name ??
                          COLUMN_LABELS[column]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Дедлайн" hint="Подсветка на карточке включится автоматически">
                <Input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Метки">
              <LabelPicker
                boardId={board.id}
                labels={board.labels}
                selectedIds={labelIds}
                onChange={setLabelIds}
                canCreate
              />
            </FormField>

            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={isBacklog}
                  onCheckedChange={(value) => setIsBacklog(value === true)}
                />
                Положить в бэклог, а не на доску
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={openAfterCreate}
                  onCheckedChange={(value) => setOpenAfterCreate(value === true)}
                />
                Открыть после создания
              </label>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={createTask.isPending}>
              Создать задачу
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
