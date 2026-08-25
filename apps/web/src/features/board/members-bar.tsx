import * as React from 'react';
import { Plus, Users } from 'lucide-react';
import { BOARD_ROLE_LABELS, type BoardDto, type PresenceUser } from '@kaif/shared';
import { useBoardWorkload } from '@/api/boards';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MemberPanel } from './member-panel';
import { AddMemberDialog } from './add-member-dialog';

/**
 * Полоса участников доски.
 *
 * Нажатие на человека открывает панель с его загрузкой и кнопкой
 * «Создать задачу на него» — самый частый сценарий у руководителя.
 * Зелёная точка — человек сейчас на доске (presence через WebSocket).
 */
export function MembersBar({
  board,
  presence,
  canManage,
  onCreateTaskFor,
}: {
  board: BoardDto;
  presence: PresenceUser[];
  canManage: boolean;
  onCreateTaskFor: (userId: string) => void;
}): React.ReactElement {
  const { data: workload } = useBoardWorkload(board.id);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);

  const onlineIds = new Set(presence.map((user) => user.userId));
  const workloadByUser = new Map((workload ?? []).map((item) => [item.user.id, item]));

  return (
    <div className="flex items-center gap-1.5">
      <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />

      <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
        {board.members.map((member) => {
          const stats = workloadByUser.get(member.userId);
          const online = onlineIds.has(member.userId);

          return (
            <Tooltip
              key={member.userId}
              content={
                <span className="block text-center">
                  <span className="block font-medium">{member.user.displayName}</span>
                  <span className="block text-[10px] opacity-80">
                    {BOARD_ROLE_LABELS[member.role]}
                    {stats ? ` · в работе: ${stats.active}` : ''}
                    {stats && stats.overdue > 0 ? ` · просрочено: ${stats.overdue}` : ''}
                  </span>
                </span>
              }
            >
              <button
                type="button"
                onClick={() => setSelectedUserId(member.userId)}
                className="relative shrink-0 rounded-full transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Профиль ${member.user.displayName}`}
              >
                <UserAvatar user={member.user} size="md" />
                {online && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-surface"
                    aria-label="сейчас на доске"
                  />
                )}
                {stats && stats.overdue > 0 && (
                  <span
                    className={cn(
                      'absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full',
                      'bg-destructive text-[9px] font-bold text-destructive-foreground ring-2 ring-surface',
                    )}
                  >
                    {stats.overdue}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>

      {canManage && (
        <Tooltip content="Добавить участника">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAddMemberOpen(true)}
            aria-label="Добавить участника"
          >
            <Plus />
          </Button>
        </Tooltip>
      )}

      <MemberPanel
        board={board}
        userId={selectedUserId}
        onOpenChange={(open) => !open && setSelectedUserId(null)}
        onCreateTaskFor={(userId) => {
          setSelectedUserId(null);
          onCreateTaskFor(userId);
        }}
        canManage={canManage}
      />

      <AddMemberDialog board={board} open={addMemberOpen} onOpenChange={setAddMemberOpen} />
    </div>
  );
}
