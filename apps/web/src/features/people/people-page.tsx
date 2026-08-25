import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, UserPlus, Users } from 'lucide-react';
import { BOARD_ROLE_LABELS, can, type MemberWorkloadDto } from '@kaif/shared';
import { useBoard, useBoardWorkload } from '@/api/boards';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Progress, Skeleton } from '@/components/ui/misc';
import { FullScreenLoader } from '@/app/loader';
import { MemberPanel } from '@/features/board/member-panel';
import { useBoardRealtime } from '@/features/board/use-board-realtime';
import { InviteDialog } from '@/features/board/invite-dialog';
import { CreateTaskDialog } from '@/features/task/create-task-dialog';
import { cn } from '@/lib/utils';

/**
 * Люди доски: кто чем занят и кто перегружен.
 * Отсюда за два клика ставится задача на конкретного человека.
 */
export function PeoplePage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const user = useAuthStore((state) => state.user);
  const { data: board, isLoading } = useBoard(boardKey);
  const { data: workload, isLoading: workloadLoading } = useBoardWorkload(board?.id);
  // Нагрузка меняется от чужих действий — экран должен обновляться сам.
  useBoardRealtime(board?.id);

  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);
  const [createTaskFor, setCreateTaskFor] = React.useState<string | null>(null);

  if (isLoading) return <FullScreenLoader inline />;
  if (!board) return <EmptyState title="Доска не найдена" />;

  const accessContext = user
    ? { globalRole: user.globalRole, boardRole: board.myRole, boardArchived: board.isArchived }
    : null;
  const canManage = accessContext ? can(accessContext, 'board.member.invite') : false;

  const maxActive = Math.max(1, ...(workload ?? []).map((item) => item.active));

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-5">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={`/boards/${board.key}`}>
            <ArrowLeft />К доске
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Users className="size-5 text-muted-foreground" />
              Люди
            </h1>
            <p className="text-sm text-muted-foreground">
              {board.name} · {board.members.length} участников
            </p>
          </div>

          {canManage && (
            <Button variant="primary" onClick={() => setAddMemberOpen(true)}>
              <UserPlus />
              Пригласить
            </Button>
          )}
        </div>
      </header>

      {workloadLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(workload ?? []).map((item) => (
            <PersonCard
              key={item.user.id}
              item={item}
              maxActive={maxActive}
              onOpen={() => setSelectedUserId(item.user.id)}
              onCreateTask={() => setCreateTaskFor(item.user.id)}
            />
          ))}
        </div>
      )}

      <MemberPanel
        board={board}
        userId={selectedUserId}
        onOpenChange={(open) => !open && setSelectedUserId(null)}
        onCreateTaskFor={(userId) => {
          setSelectedUserId(null);
          setCreateTaskFor(userId);
        }}
        canManage={canManage}
      />

      <InviteDialog board={board} open={addMemberOpen} onOpenChange={setAddMemberOpen} />

      <CreateTaskDialog
        board={board}
        open={Boolean(createTaskFor)}
        onOpenChange={(open) => !open && setCreateTaskFor(null)}
        defaults={createTaskFor ? { assigneeId: createTaskFor } : {}}
      />
    </div>
  );
}

function PersonCard({
  item,
  maxActive,
  onOpen,
  onCreateTask,
}: {
  item: MemberWorkloadDto;
  maxActive: number;
  onOpen: () => void;
  onCreateTask: () => void;
}): React.ReactElement {
  const load = (item.active / maxActive) * 100;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover">
      <button type="button" onClick={onOpen} className="flex items-center gap-3 text-left">
        <UserAvatar user={item.user} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-medium">{item.user.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {BOARD_ROLE_LABELS[item.role]}
            {item.user.tgUsername ? ` · @${item.user.tgUsername}` : ''}
          </p>
        </div>
      </button>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Загрузка</span>
          <span>{item.active} активных</span>
        </div>
        <Progress
          value={load}
          indicatorClassName={cn(
            load > 80 ? 'bg-destructive' : load > 50 ? 'bg-warning' : 'bg-success',
          )}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {item.inProgress > 0 && <Badge variant="primary">в работе: {item.inProgress}</Badge>}
        {item.qa > 0 && <Badge variant="outline">на тесте: {item.qa}</Badge>}
        {item.dueToday > 0 && <Badge variant="warning">сегодня: {item.dueToday}</Badge>}
        {item.overdue > 0 && <Badge variant="danger">просрочено: {item.overdue}</Badge>}
        {item.done30d > 0 && <Badge variant="success">закрыто за месяц: {item.done30d}</Badge>}
      </div>

      <Button variant="outline" size="sm" className="mt-auto" onClick={onCreateTask}>
        <Plus />
        Создать задачу
      </Button>
    </div>
  );
}
