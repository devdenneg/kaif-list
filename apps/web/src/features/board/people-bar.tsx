import * as React from 'react';
import { Layers, UserPlus, UserRound, UserX, X } from 'lucide-react';
import { BOARD_ROLE_LABELS, can, type BoardDto, type PresenceUser } from '@kaif/shared';
import { useBoardWorkload } from '@/api/boards';
import { EMPTY_FILTERS, useUiStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MemberPanel } from './member-panel';
import { InviteDialog } from './invite-dialog';
import { GroupPickerMenu } from './group-picker';

/**
 * Быстрая фильтрация по людям — как в Jira: имена стоят слева направо,
 * клик показывает задачи, где человек исполнитель. Повторный клик снимает,
 * несколько человек складываются (показываем задачи любого из выбранных).
 *
 * Полоса живёт над доской и завязана на общий стор фильтров, поэтому
 * согласована с поповером «Фильтры» и с фильтром по группам.
 */
export function PeopleBar({
  board,
  presence,
  canManage,
  onCreateTaskFor,
  compact = false,
}: {
  board: BoardDto;
  presence: PresenceUser[];
  canManage: boolean;
  onCreateTaskFor: (userId: string) => void;
  compact?: boolean;
}): React.ReactElement {
  const currentUser = useAuthStore((state) => state.user);
  const canSeeStats = currentUser
    ? can(
        {
          globalRole: currentUser.globalRole,
          boardRole: board.myRole,
          boardArchived: board.isArchived,
        },
        'board.analytics.view',
      )
    : false;
  const { data: workload } = useBoardWorkload(board.id, canSeeStats);
  const filters = useUiStore((state) => state.filters[board.id]) ?? EMPTY_FILTERS;
  const setFilters = useUiStore((state) => state.setFilters);

  const [profileUserId, setProfileUserId] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const onlineIds = new Set(presence.map((user) => user.userId));
  const workloadByUser = new Map((workload ?? []).map((item) => [item.user.id, item]));

  const selected = filters.assigneeIds;
  const groupMemberIds = new Set(
    board.groups
      .filter((group) => filters.groupIds.includes(group.id))
      .flatMap((group) => group.members.map((member) => member.id)),
  );

  const toggleAssignee = (userId: string): void => {
    setFilters(board.id, {
      assigneeIds: selected.includes(userId)
        ? selected.filter((id) => id !== userId)
        : [...selected, userId],
    });
  };

  const soleSelectedId = selected.length === 1 ? selected[0] : null;
  const soleSelected = soleSelectedId
    ? board.members.find((member) => member.userId === soleSelectedId)
    : undefined;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
        {board.members.map((member) => {
          const stats = workloadByUser.get(member.userId);
          const active = selected.includes(member.userId);
          // Человек попал в выборку через фильтр по группе — подсвечиваем мягко,
          // чтобы было видно, кого именно показывает активная группа.
          const viaGroup = !active && groupMemberIds.has(member.userId);

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
                  <span className="mt-0.5 block text-[10px] opacity-60">
                    {active ? 'Клик — снять фильтр' : 'Клик — только его задачи'}
                  </span>
                </span>
              }
            >
              <button
                type="button"
                onClick={() => toggleAssignee(member.userId)}
                aria-pressed={active}
                className={cn(
                  'relative flex h-8 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 transition-colors',
                  compact ? 'pl-0.5' : 'pl-0.5',
                  active
                    ? 'border-primary bg-accent text-accent-foreground'
                    : viaGroup
                      ? 'border-primary/40 bg-accent/40 text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-secondary',
                )}
              >
                <span className="relative shrink-0">
                  <UserAvatar user={member.user} size="sm" />
                  {onlineIds.has(member.userId) && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-surface"
                      aria-label="сейчас на доске"
                    />
                  )}
                  {stats && stats.overdue > 0 && (
                    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground ring-2 ring-surface">
                      {stats.overdue}
                    </span>
                  )}
                </span>
                {!compact && (
                  <span className="max-w-[7rem] truncate text-xs font-medium">
                    {firstName(member.user.displayName)}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}

        <Tooltip content="Задачи, которые никто не взял">
          <button
            type="button"
            onClick={() => setFilters(board.id, { unassigned: !filters.unassigned })}
            aria-pressed={filters.unassigned}
            aria-label="Без исполнителя"
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors',
              filters.unassigned
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-dashed border-border text-muted-foreground hover:bg-secondary',
            )}
          >
            <UserX className="size-3.5" />
            {!compact && 'Свободные'}
          </button>
        </Tooltip>
      </div>

      {/* ── Действия над выбранным человеком ── */}
      {soleSelected && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5">
          <Tooltip content={`Профиль и загрузка · ${soleSelected.user.displayName}`}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setProfileUserId(soleSelected.userId)}
              aria-label={`Профиль ${soleSelected.user.displayName}`}
            >
              <UserRound />
            </Button>
          </Tooltip>
          <Tooltip content={`Создать задачу на ${soleSelected.user.displayName}`}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onCreateTaskFor(soleSelected.userId)}
              aria-label="Создать задачу на выбранного человека"
            >
              <UserPlus />
            </Button>
          </Tooltip>
          {canManage && (
            <GroupPickerMenu
              board={board}
              userId={soleSelected.userId}
              canManage={canManage}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Рабочие группы · ${soleSelected.user.displayName}`}
                  title="Прикрепить к рабочей группе"
                >
                  <Layers />
                </Button>
              }
            />
          )}
        </div>
      )}

      {(selected.length > 0 || filters.unassigned) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
          onClick={() => setFilters(board.id, { assigneeIds: [], unassigned: false })}
        >
          <X />
          {!compact && 'Все'}
        </Button>
      )}

      {canManage && (
        <Tooltip content="Пригласить в доску по ссылке">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => setInviteOpen(true)}
            aria-label="Пригласить в доску"
          >
            <UserPlus />
          </Button>
        </Tooltip>
      )}

      <MemberPanel
        board={board}
        userId={profileUserId}
        onOpenChange={(open) => !open && setProfileUserId(null)}
        onCreateTaskFor={(userId) => {
          setProfileUserId(null);
          onCreateTaskFor(userId);
        }}
        canManage={canManage}
      />

      <InviteDialog board={board} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

/** В полосе людей важна плотность: фамилия обычно не нужна, чтобы узнать коллегу. */
function firstName(displayName: string): string {
  const [first] = displayName.trim().split(/\s+/);
  return first ?? displayName;
}
