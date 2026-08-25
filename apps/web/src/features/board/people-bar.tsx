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
import { shortNames } from '@/lib/short-names';
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
  canCreate,
  canManage,
  onCreateTaskFor,
  compact = false,
}: {
  board: BoardDto;
  presence: PresenceUser[];
  canCreate: boolean;
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
        'board.workload.view',
      )
    : false;
  const { data: workload } = useBoardWorkload(board.id, canSeeStats);
  const filters = useUiStore((state) => state.filters[board.id]) ?? EMPTY_FILTERS;
  const setFilters = useUiStore((state) => state.setFilters);

  const [profileUserId, setProfileUserId] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  // Подписи считаем по всему списку сразу: понять, что имя не уникально,
  // глядя на одного человека, невозможно.
  const labels = shortNames(board.members.map((member) => member.user));
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
  const hasSelection = selected.length > 0 || filters.unassigned;
  const selectionLabel = soleSelected
    ? (labels.get(soleSelected.userId) ?? soleSelected.user.displayName)
    : selected.length > 0
      ? `Выбрано: ${selected.length}`
      : 'Без исполнителя';

  return (
    <div className={cn('min-w-0', compact ? 'space-y-1.5' : 'flex items-center gap-1.5')}>
      <div
        className={cn(
          'scrollbar-thin flex min-w-0 items-center overflow-x-auto',
          compact ? 'w-full gap-1.5 pb-1' : 'flex-1 gap-1 pb-0.5',
        )}
      >
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
                aria-label={`${active ? 'Снять фильтр' : 'Показать задачи'}: ${member.user.displayName}`}
                className={cn(
                  'relative flex shrink-0 items-center rounded-full border leading-none transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                  compact ? 'size-10 justify-center p-0' : 'h-8 gap-1.5 py-0 pl-1 pr-2.5',
                  active
                    ? 'border-primary bg-accent text-accent-foreground'
                    : viaGroup
                      ? 'border-primary/40 bg-accent/40 text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'relative flex shrink-0 items-center justify-center leading-none',
                    compact ? 'size-8' : 'size-6',
                  )}
                >
                  <UserAvatar user={member.user} size={compact ? 'md' : 'sm'} />
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
                  <span className="max-w-[8rem] truncate text-xs font-medium">
                    {labels.get(member.userId) ?? member.user.displayName}
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
              'flex shrink-0 items-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
              compact ? 'size-10 justify-center' : 'h-8 gap-1.5 px-2',
              filters.unassigned
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-dashed border-border text-muted-foreground hover:bg-secondary',
            )}
          >
            <UserX className="size-4" />
            {!compact && 'Свободные'}
          </button>
        </Tooltip>

        {canManage && (
          <Tooltip content="Пригласить в доску по ссылке">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'shrink-0 rounded-full border border-dashed border-border text-muted-foreground [&_svg]:!size-4',
                compact ? 'size-10' : 'size-8',
              )}
              onClick={() => setInviteOpen(true)}
              aria-label="Пригласить в доску"
            >
              <UserPlus />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* ── На телефоне действия не отнимают место у прокрутки людей. ── */}
      {hasSelection && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            compact
              ? 'min-h-11 rounded-lg border border-border bg-secondary/40 p-1'
              : 'border-l border-border pl-1.5',
          )}
        >
          {compact && (
            <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium">
              {selectionLabel}
            </span>
          )}

          {soleSelected && (
            <>
              <Tooltip content={`Профиль и загрузка · ${soleSelected.user.displayName}`}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn('[&_svg]:!size-4', compact ? 'size-10' : 'size-8')}
                  onClick={() => setProfileUserId(soleSelected.userId)}
                  aria-label={`Профиль ${soleSelected.user.displayName}`}
                >
                  <UserRound />
                </Button>
              </Tooltip>
              {canCreate && (
                <Tooltip content={`Создать задачу на ${soleSelected.user.displayName}`}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn('[&_svg]:!size-4', compact ? 'size-10' : 'size-8')}
                    onClick={() => onCreateTaskFor(soleSelected.userId)}
                    aria-label="Создать задачу на выбранного человека"
                  >
                    <UserPlus />
                  </Button>
                </Tooltip>
              )}
              {canManage && (
                <GroupPickerMenu
                  board={board}
                  userId={soleSelected.userId}
                  canManage={canManage}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn('[&_svg]:!size-4', compact ? 'size-10' : 'size-8')}
                      aria-label={`Рабочие группы · ${soleSelected.user.displayName}`}
                      title="Прикрепить к рабочей группе"
                    >
                      <Layers />
                    </Button>
                  }
                />
              )}
            </>
          )}

          <Button
            variant="ghost"
            size={compact ? 'icon-sm' : 'sm'}
            className={cn(
              'shrink-0 text-xs text-muted-foreground [&_svg]:!size-4',
              compact ? 'size-10' : 'h-8 px-2',
            )}
            onClick={() => setFilters(board.id, { assigneeIds: [], unassigned: false })}
            aria-label={compact ? 'Снять фильтр по людям' : undefined}
          >
            <X />
            {!compact && 'Все'}
          </Button>
        </div>
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

