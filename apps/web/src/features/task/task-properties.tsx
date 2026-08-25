import * as React from 'react';
import {
  Bell,
  BellOff,
  CalendarClock,
  CalendarPlus,
  Clock,
  Gauge,
  Link2,
  Plus,
  Tag,
  Trash2,
  UserCheck,
  UserCog,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_LABELS,
  TASK_LINK_LABELS,
  TASK_TYPE_LABELS,
  TaskLinkType,
  TaskPriority,
  TaskType,
  type BoardDto,
  type TaskDetailDto,
} from '@kaif/shared';
import { useUpdateTask, useTaskLinks, useWatchTask } from '@/api/tasks';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn, formatDuration, fromDateTimeLocal, toDateTimeLocal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserPicker } from './user-picker';
import { LabelPicker } from './label-picker';
import { DueBadge, PriorityIcon, TaskTypeIcon } from './task-visuals';
import { MoveReasonDialog, type ReasonRequest } from './move-reason-dialog';

/** Правая колонка карточки задачи: все поля в одном месте. */
export function TaskProperties({
  task,
  board,
  onMoveColumn,
  movePending = false,
}: {
  task: TaskDetailDto;
  board: BoardDto | undefined;
  onMoveColumn: (column: string) => void;
  movePending?: boolean;
}): React.ReactElement {
  const updateTask = useUpdateTask(task.id, task.boardId);
  const watchTask = useWatchTask(task.id);
  const links = useTaskLinks(task.id, task.boardId);

  const [reasonRequest, setReasonRequest] = React.useState<ReasonRequest | null>(null);
  const [pendingUpdate, setPendingUpdate] = React.useState<Record<string, unknown> | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);

  const editable = task.permissions.canUpdate;

  /**
   * Универсальное обновление поля.
   * Если сервер требует объяснения (перенос дедлайна, смена исполнителя
   * у задачи в работе) — показываем окно и повторяем запрос с причиной.
   */
  const update = (patch: Record<string, unknown>, reason?: string): void => {
    updateTask.mutate(
      { ...patch, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          setReasonRequest(null);
          setPendingUpdate(null);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.needsReason && error.reasonRequired) {
            setPendingUpdate(patch);
            setReasonRequest({
              code: error.reasonRequired.code,
              message: error.reasonRequired.message,
            });
            return;
          }
          toast.error('Не удалось сохранить', error);
        },
      },
    );
  };

  return (
    <div className="space-y-4 text-sm">
      <Field icon={<Gauge />} label="Статус">
        <Select
          value={task.columnKey}
          onValueChange={onMoveColumn}
          disabled={!task.permissions.canMove || movePending}
        >
          <SelectTrigger className="h-8 [@media(pointer:coarse)]:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLUMN_ORDER.map((column) => (
              <SelectItem key={column} value={column}>
                {board?.columns.find((item) => item.key === column)?.name ?? COLUMN_LABELS[column]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field icon={<UserCheck />} label="Исполнитель">
        <UserPicker
          members={board?.members ?? []}
          value={task.assignee}
          onChange={(userId) => update({ assigneeId: userId })}
          disabled={!editable}
        />
      </Field>

      <Field icon={<UserCog />} label="Тестировщик">
        <UserPicker
          members={board?.members ?? []}
          value={task.tester}
          onChange={(userId) => update({ testerId: userId })}
          placeholder="Не назначен"
          disabled={!editable}
        />
      </Field>

      <Field icon={<PriorityIcon priority={task.priority} />} label="Приоритет">
        <Select
          value={task.priority}
          onValueChange={(value) => update({ priority: value })}
          disabled={!editable}
        >
          <SelectTrigger className="h-8 [@media(pointer:coarse)]:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(TaskPriority).map((priority) => (
              <SelectItem key={priority} value={priority}>
                <span className="flex items-center gap-2">
                  <PriorityIcon priority={priority} />
                  {PRIORITY_LABELS[priority]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field icon={<TaskTypeIcon type={task.type} />} label="Тип">
        <Select
          value={task.type}
          onValueChange={(value) => update({ type: value })}
          disabled={!editable}
        >
          <SelectTrigger className="h-8 [@media(pointer:coarse)]:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(TaskType).map((type) => (
              <SelectItem key={type} value={type}>
                <span className="flex items-center gap-2">
                  <TaskTypeIcon type={type} />
                  {TASK_TYPE_LABELS[type]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field icon={<Tag />} label="Метки">
        <LabelPicker
          boardId={task.boardId}
          labels={board?.labels ?? []}
          selectedIds={task.labels.map((label) => label.id)}
          onChange={(ids) => update({ labelIds: ids })}
          canCreate={editable}
          disabled={!editable}
        />
      </Field>

      <Separator />

      <Field icon={<CalendarPlus />} label="Начало">
        <Input
          type="datetime-local"
          value={toDateTimeLocal(task.startDate)}
          onChange={(event) => update({ startDate: fromDateTimeLocal(event.target.value) })}
          disabled={!editable}
          className="h-8 [@media(pointer:coarse)]:h-11"
        />
      </Field>

      <Field icon={<CalendarClock />} label="Дедлайн">
        <div className="space-y-1.5">
          <Input
            type="datetime-local"
            value={toDateTimeLocal(task.dueDate)}
            onChange={(event) => update({ dueDate: fromDateTimeLocal(event.target.value) })}
            disabled={!editable}
            className="h-8 [@media(pointer:coarse)]:h-11"
          />
          {task.dueDate && (
            <DueBadge dueDate={task.dueDate} completed={task.completedAt !== null} showLabel />
          )}
        </div>
      </Field>

      <Field icon={<Clock />} label="Оценка">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={999}
            value={task.storyPoints ?? ''}
            onChange={(event) =>
              update({ storyPoints: event.target.value === '' ? null : Number(event.target.value) })
            }
            placeholder="SP"
            disabled={!editable}
            className="h-8 w-20 [@media(pointer:coarse)]:h-11"
          />
          <Input
            type="number"
            min={0}
            step={30}
            value={task.estimateMinutes ?? ''}
            onChange={(event) =>
              update({
                estimateMinutes: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            placeholder="мин"
            disabled={!editable}
            className="h-8 flex-1 [@media(pointer:coarse)]:h-11"
          />
        </div>
        {task.estimateMinutes ? (
          <p className="mt-1 text-xs text-muted-foreground">
            План: {formatDuration(task.estimateMinutes)}
            {task.spentMinutes ? ` · Факт: ${formatDuration(task.spentMinutes)}` : ''}
          </p>
        ) : null}
      </Field>

      <Separator />

      {/* ── Связи между задачами ── */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <Link2 className="size-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Связи
          </span>
          {task.permissions.canManageLinks && (
            <Popover open={linkOpen} onOpenChange={setLinkOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto [@media(pointer:coarse)]:size-10"
                  aria-label="Добавить связь"
                >
                  <Plus />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <AddLinkForm
                  onSubmit={(type, key) => {
                    links.createLink.mutate(
                      { type, targetTaskKey: key },
                      {
                        onSuccess: () => setLinkOpen(false),
                        onError: (error) => toast.error('Не удалось связать', error),
                      },
                    );
                  }}
                  loading={links.createLink.isPending}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>

        {task.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">Связей нет</p>
        ) : (
          <ul className="space-y-1">
            {task.links.map((link) => (
              <li
                key={link.id}
                className="group flex items-center gap-1.5 text-xs [@media(pointer:coarse)]:min-h-10"
              >
                <span className="shrink-0 text-muted-foreground">
                  {TASK_LINK_LABELS[link.type]}
                </span>
                <a
                  href={`/tasks/${link.task.key}`}
                  className={cn(
                    'min-w-0 flex-1 truncate font-medium text-primary hover:underline',
                    link.task.isArchived && 'line-through opacity-60',
                  )}
                >
                  {link.task.key} · {link.task.title}
                </a>
                {task.permissions.canManageLinks && (
                  <button
                    type="button"
                    onClick={() => links.deleteLink.mutate(link.id)}
                    className="shrink-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:opacity-100"
                    aria-label="Удалить связь"
                  >
                    <Trash2 className="size-3 text-muted-foreground" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      <Button
        variant={task.watching ? 'secondary' : 'outline'}
        size="sm"
        className="w-full [@media(pointer:coarse)]:min-h-11"
        onClick={() => watchTask.mutate(!task.watching)}
        loading={watchTask.isPending}
      >
        {task.watching ? <Bell /> : <BellOff />}
        {task.watching ? 'Вы следите за задачей' : 'Следить за задачей'}
      </Button>

      <MoveReasonDialog
        open={Boolean(reasonRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setReasonRequest(null);
            setPendingUpdate(null);
          }
        }}
        request={reasonRequest}
        loading={updateTask.isPending}
        onSubmit={(reason) => {
          if (pendingUpdate) update(pendingUpdate, reason);
        }}
      />
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function AddLinkForm({
  onSubmit,
  loading,
}: {
  onSubmit: (type: TaskLinkType, key: string) => void;
  loading: boolean;
}): React.ReactElement {
  const [type, setType] = React.useState<TaskLinkType>(TaskLinkType.RELATES);
  const [key, setKey] = React.useState('');

  return (
    <div className="space-y-2">
      <Select value={type} onValueChange={(value) => setType(value as TaskLinkType)}>
        <SelectTrigger className="h-8 [@media(pointer:coarse)]:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.values(TaskLinkType).map((item) => (
            <SelectItem key={item} value={item}>
              {TASK_LINK_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={key}
        onChange={(event) => setKey(event.target.value.toUpperCase())}
        placeholder="Ключ задачи, например OPS-12"
        className="h-8 font-mono [@media(pointer:coarse)]:h-11"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && key.trim()) onSubmit(type, key.trim());
        }}
      />

      <Button
        variant="primary"
        size="sm"
        className="w-full [@media(pointer:coarse)]:min-h-11"
        disabled={!key.trim()}
        loading={loading}
        onClick={() => onSubmit(type, key.trim())}
      >
        Связать
      </Button>
    </div>
  );
}
