import * as React from 'react';
import { History } from 'lucide-react';
import { ActivityType, COLUMN_LABELS, PRIORITY_LABELS, type ActivityDto } from '@kaif/shared';
import { useTaskActivity } from '@/api/tasks';
import { UserAvatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import { formatFullDateTime, formatRelative } from '@/lib/utils';

/** Полная история задачи: кто, что и когда менял. */
export function TaskActivity({ taskId }: { taskId: string }): React.ReactElement {
  const { data: items, isLoading } = useTaskActivity(taskId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">История пуста</p>;
  }

  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5 text-sm">
          <UserAvatar user={item.actor} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="leading-snug">
              <span className="font-medium">{item.actor?.displayName ?? 'Система'}</span>{' '}
              <span className="text-muted-foreground">{describeActivity(item)}</span>
            </p>
            <Tooltip content={formatFullDateTime(item.createdAt)}>
              <span className="text-xs text-muted-foreground">{formatRelative(item.createdAt)}</span>
            </Tooltip>
          </div>
          <History className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
        </li>
      ))}
    </ol>
  );
}

function describeActivity(item: ActivityDto): string {
  const payload = item.payload as Record<string, unknown>;
  const reason = typeof payload.reason === 'string' ? ` — «${payload.reason}»` : '';

  switch (item.type) {
    case ActivityType.TASK_CREATED:
      return 'создал(а) задачу';
    case ActivityType.TASK_MOVED: {
      const from = payload.fromLabel ?? COLUMN_LABELS[payload.from as keyof typeof COLUMN_LABELS];
      const to = payload.toLabel ?? COLUMN_LABELS[payload.to as keyof typeof COLUMN_LABELS];
      return `перенёс(ла) ${from} → ${to}${reason}`;
    }
    case ActivityType.TASK_MOVED_TO_BACKLOG:
      return 'отправил(а) задачу в бэклог';
    case ActivityType.TASK_MOVED_TO_BOARD:
      return 'вернул(а) задачу на доску';
    case ActivityType.TASK_ASSIGNED:
      return `назначил(а) исполнителя${reason}`;
    case ActivityType.TASK_UNASSIGNED:
      return `снял(а) исполнителя${reason}`;
    case ActivityType.TASK_TESTER_CHANGED:
      return 'изменил(а) тестировщика';
    case ActivityType.TASK_DUE_DATE_CHANGED:
      return `изменил(а) дедлайн${reason}`;
    case ActivityType.TASK_PRIORITY_CHANGED:
      return `изменил(а) приоритет на ${PRIORITY_LABELS[payload.to as keyof typeof PRIORITY_LABELS] ?? ''}`;
    case ActivityType.TASK_UPDATED: {
      const fields = Array.isArray(payload.fields) ? (payload.fields as string[]) : [];
      return fields.length > 0 ? `изменил(а): ${fields.join(', ')}` : 'обновил(а) задачу';
    }
    case ActivityType.TASK_ARCHIVED:
      return `отправил(а) в архив${reason}`;
    case ActivityType.TASK_RESTORED:
      return 'вернул(а) из архива';
    case ActivityType.COMMENT_CREATED:
      return 'оставил(а) комментарий';
    case ActivityType.COMMENT_DELETED:
      return 'удалил(а) комментарий';
    case ActivityType.ATTACHMENT_ADDED:
      return `приложил(а) файл ${typeof payload.filename === 'string' ? payload.filename : ''}`;
    case ActivityType.ATTACHMENT_REMOVED:
      return 'удалил(а) файл';
    case ActivityType.CHECKLIST_UPDATED:
      return 'обновил(а) чек-лист';
    case ActivityType.TASK_LINK_ADDED:
      return `добавил(а) связь с ${typeof payload.targetKey === 'string' ? payload.targetKey : 'задачей'}`;
    case ActivityType.TASK_LINK_REMOVED:
      return 'удалил(а) связь';
    default:
      return 'внёс(ла) изменение';
  }
}
