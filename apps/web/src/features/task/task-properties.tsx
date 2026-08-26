import * as React from 'react';
import { Bell, BellOff, CalendarClock, Clock, Gauge, Tag, UserCheck, UserCog } from 'lucide-react';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskType,
  type BoardDto,
  type TaskDetailDto,
} from '@kaif/shared';
import { useUpdateTask, useWatchTask } from '@/api/tasks';
import { DueSummary } from './due-summary';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn, formatDuration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  const timeZone = useAuthStore((state) => state.user?.timezone);

  const [reasonRequest, setReasonRequest] = React.useState<ReasonRequest | null>(null);
  const [pendingUpdate, setPendingUpdate] = React.useState<Record<string, unknown> | null>(null);

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
      <PropertySection title="Основное">
        <Field icon={<Gauge />} label="Статус">
          <Select
            value={task.columnKey}
            onValueChange={onMoveColumn}
            disabled={!task.permissions.canMove || movePending}
          >
            <SelectTrigger
              className="h-9 min-w-0 px-2 shadow-none [@media(pointer:coarse)]:h-11"
              aria-label="Статус задачи"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_ORDER.map((column) => (
                <SelectItem key={column} value={column}>
                  {board?.columns.find((item) => item.key === column)?.name ??
                    COLUMN_LABELS[column]}
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
            ariaLabel="Исполнитель"
            triggerClassName="min-h-9 rounded-lg border border-input bg-surface shadow-none [@media(pointer:coarse)]:min-h-11"
          />
        </Field>

        <Field icon={<UserCog />} label="Тестировщик">
          <UserPicker
            members={board?.members ?? []}
            value={task.tester}
            onChange={(userId) => update({ testerId: userId })}
            placeholder="Не назначен"
            disabled={!editable}
            ariaLabel="Тестировщик"
            triggerClassName="min-h-9 rounded-lg border border-input bg-surface shadow-none [@media(pointer:coarse)]:min-h-11"
          />
        </Field>

        <Field icon={<PriorityIcon priority={task.priority} />} label="Приоритет">
          <Select
            value={task.priority}
            onValueChange={(value) => update({ priority: value })}
            disabled={!editable}
          >
            <SelectTrigger
              className="h-9 min-w-0 px-2 shadow-none [@media(pointer:coarse)]:h-11"
              aria-label="Приоритет задачи"
            >
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
            <SelectTrigger
              className="h-9 min-w-0 px-2 shadow-none [@media(pointer:coarse)]:h-11"
              aria-label="Тип задачи"
            >
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

        <Field icon={<Tag />} label="Метки" align="start">
          <LabelPicker
            boardId={task.boardId}
            labels={board?.labels ?? []}
            selectedIds={task.labels.map((label) => label.id)}
            onChange={(ids) => update({ labelIds: ids })}
            canCreate={editable}
            disabled={!editable}
            ariaLabel="Метки задачи"
            triggerClassName="min-h-9 rounded-lg border border-input bg-surface shadow-none [@media(pointer:coarse)]:min-h-11"
          />
        </Field>
      </PropertySection>

      <PropertySection title="Сроки и оценка">
        <Field icon={<CalendarClock />} label="Дедлайн" layout="stacked">
          <div className="space-y-1.5">
            <DateTimePicker
              value={task.dueDate}
              onChange={(value) => update({ dueDate: value })}
              disabled={!editable}
              placeholder="Добавить дедлайн"
              aria-label="Дедлайн задачи"
              {...(timeZone ? { timeZone } : {})}
            />
            {task.dueDate && (
              <div className="flex justify-end">
                <DueBadge
                  dueDate={task.dueDate}
                  completed={task.completedAt !== null}
                  showLabel
                  {...(timeZone ? { timeZone } : {})}
                />
              </div>
            )}
            <DueSummary task={task} {...(timeZone ? { timeZone } : {})} />
          </div>
        </Field>

        <Field icon={<Clock />} label="Оценка" align="start">
          <div>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                type="number"
                min={0}
                max={999}
                value={task.storyPoints ?? ''}
                onChange={(event) =>
                  update({
                    storyPoints: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
                placeholder="SP"
                aria-label="Оценка в story points"
                disabled={!editable}
                className="h-9 min-w-0 px-2 shadow-none [@media(pointer:coarse)]:h-11"
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
                aria-label="Оценка в минутах"
                disabled={!editable}
                className="h-9 min-w-0 px-2 shadow-none [@media(pointer:coarse)]:h-11"
              />
            </div>
            {task.estimateMinutes ? (
              <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
                План: {formatDuration(task.estimateMinutes)}
                {task.spentMinutes ? ` · Факт: ${formatDuration(task.spentMinutes)}` : ''}
              </p>
            ) : null}
          </div>
        </Field>
      </PropertySection>

      <Button
        variant={task.watching ? 'secondary' : 'outline'}
        size="sm"
        className="min-h-10 w-full [@media(pointer:coarse)]:min-h-11"
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
  align = 'center',
  layout = 'row',
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  align?: 'center' | 'start';
  layout?: 'row' | 'stacked';
}): React.ReactElement {
  const labelId = React.useId();

  return (
    <div
      className={cn(
        'grid min-h-12',
        layout === 'stacked'
          ? 'grid-cols-1 gap-1.5 py-2.5'
          : 'grid-cols-1 gap-1.5 py-2.5 sm:grid-cols-[6.75rem_minmax(0,1fr)] sm:gap-2 sm:py-1.5',
        layout === 'row' && (align === 'start' ? 'sm:items-start' : 'sm:items-center'),
      )}
    >
      <div
        id={labelId}
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
          layout === 'row' && align === 'start' && 'sm:pt-2.5',
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0" role="group" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}

function PropertySection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const titleId = React.useId();

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-1.5 flex min-h-8 items-center gap-2">
        <h3
          id={titleId}
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="divide-y divide-border/70 border-y border-border/70">{children}</div>
    </section>
  );
}
