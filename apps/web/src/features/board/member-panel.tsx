import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, LogOut, Plus, Shield } from 'lucide-react';
import { BOARD_ROLE_LABELS, BoardRole, type BoardDto } from '@kaif/shared';
import { useBoardWorkload, useChangeMemberRole, useRemoveMember } from '@/api/boards';
import { useTaskList } from '@/api/tasks';
import { EMPTY_FILTERS } from '@/stores/ui';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Separator, Skeleton } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TaskCard } from './task-card';
import { toast } from '@/lib/toast';
import { useAuthStore } from '@/stores/auth';

/**
 * Панель участника: загрузка, его задачи и быстрые действия.
 * Отсюда же назначается роль и создаётся задача на человека.
 */
export function MemberPanel({
  board,
  userId,
  onOpenChange,
  onCreateTaskFor,
  canManage,
}: {
  board: BoardDto;
  userId: string | null;
  onOpenChange: (open: boolean) => void;
  onCreateTaskFor: (userId: string) => void;
  canManage: boolean;
}): React.ReactElement | null {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: workload } = useBoardWorkload(board.id);
  const changeRole = useChangeMemberRole(board.id);
  const removeMember = useRemoveMember(board.id);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const member = board.members.find((item) => item.userId === userId);
  const stats = workload?.find((item) => item.user.id === userId);

  const { data: tasks, isLoading } = useTaskList(userId ? board.id : undefined, {
    ...EMPTY_FILTERS,
    assigneeIds: userId ? [userId] : [],
    sort: 'dueDate',
  });

  if (!member) return null;

  const isSelf = member.userId === currentUserId;
  const isOwner = member.role === BoardRole.OWNER;

  return (
    <>
      <Sheet open={Boolean(userId)} onOpenChange={onOpenChange}>
        <SheetContent width="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle asChild>
              <div className="flex items-center gap-3">
                <UserAvatar user={member.user} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{member.user.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.user.tgUsername ? `@${member.user.tgUsername} · ` : ''}
                    {BOARD_ROLE_LABELS[member.role]}
                  </p>
                </div>
              </div>
            </SheetTitle>
          </SheetHeader>

          <SheetBody className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="В работе" value={stats?.inProgress ?? 0} />
              <StatTile label="Активных" value={stats?.active ?? 0} />
              <StatTile
                label="Просрочено"
                value={stats?.overdue ?? 0}
                tone={stats && stats.overdue > 0 ? 'danger' : 'default'}
                icon={<AlertTriangle />}
              />
              <StatTile
                label="Закрыто за 30 дней"
                value={stats?.done30d ?? 0}
                tone="success"
                icon={<CheckCircle2 />}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => onCreateTaskFor(member.userId)}>
                <Plus />
                Создать задачу на него
              </Button>

              {canManage && !isOwner && (
                <Select
                  value={member.role}
                  onValueChange={(value) => {
                    changeRole.mutate(
                      { userId: member.userId, role: value as BoardRole },
                      {
                        onSuccess: () => toast.success('Роль обновлена'),
                        onError: (error) => toast.error('Не удалось изменить роль', error),
                      },
                    );
                  }}
                >
                  <SelectTrigger className="h-8 w-40">
                    <Shield className="size-3.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BoardRole.ADMIN}>Администратор</SelectItem>
                    <SelectItem value={BoardRole.MEMBER}>Участник</SelectItem>
                    <SelectItem value={BoardRole.VIEWER}>Наблюдатель</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {(canManage || isSelf) && !isOwner && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
                  <LogOut />
                  {isSelf ? 'Покинуть доску' : 'Исключить'}
                </Button>
              )}
            </div>

            <Separator />

            <div>
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Задачи по срокам</h3>
                {stats && stats.dueToday > 0 && (
                  <Badge variant="warning">сегодня: {stats.dueToday}</Badge>
                )}
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 rounded-lg" />
                  ))}
                </div>
              ) : (tasks ?? []).length === 0 ? (
                <EmptyState title="Задач нет" description="Человек свободен — можно нагружать." />
              ) : (
                <div className="space-y-2">
                  {(tasks ?? []).map((task) => (
                    <Link key={task.id} to={`/tasks/${task.key}`} className="block">
                      <TaskCard task={task} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={isSelf ? 'Покинуть доску?' : `Исключить ${member.user.displayName}?`}
        description={
          isSelf
            ? 'Вы потеряете доступ к доске. Вернуть его сможет владелец или администратор.'
            : 'Активные задачи человека останутся, но исполнитель будет снят.'
        }
        confirmLabel={isSelf ? 'Покинуть' : 'Исключить'}
        loading={removeMember.isPending}
        onConfirm={() => {
          removeMember.mutate(member.userId, {
            onSuccess: () => {
              toast.success(isSelf ? 'Вы покинули доску' : 'Участник исключён');
              setConfirmRemove(false);
              onOpenChange(false);
            },
            onError: (error) => toast.error('Не удалось выполнить действие', error),
          });
        }}
      />
    </>
  );
}

function StatTile({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'danger' | 'success';
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground [&_svg]:size-3">
        {icon}
        {label}
      </p>
      <p
        className={
          tone === 'danger'
            ? 'text-lg font-semibold text-destructive'
            : tone === 'success'
              ? 'text-lg font-semibold text-success'
              : 'text-lg font-semibold'
        }
      >
        {value}
      </p>
    </div>
  );
}
