import * as React from 'react';
import { ChevronDown, Layers, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { LABEL_COLORS, type BoardDto, type BoardGroupDto } from '@kaif/shared';
import { useCreateGroup, useDeleteGroup, useSetGroupMembers, useUpdateGroup } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/avatar';
import { Checkbox, EmptyState } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Рабочие группы доски: разработка, тестирование, аналитика.
 *
 * Группа — это ярлык на людях, а не отдельные права: она нужна, чтобы одним
 * нажатием оставить на доске задачи только своего направления.
 */
export function BoardGroupsTab({ board }: { board: BoardDto }): React.ReactElement {
  const createGroup = useCreateGroup(board.id);
  const deleteGroup = useDeleteGroup(board.id);

  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState<string>(LABEL_COLORS[0] ?? '#6366f1');
  const [pendingDelete, setPendingDelete] = React.useState<BoardGroupDto | null>(null);

  const create = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createGroup.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          toast.success('Группа создана');
          setName('');
          setColor(LABEL_COLORS[(board.groups.length + 1) % LABEL_COLORS.length] ?? '#6366f1');
        },
        onError: (error) => toast.error('Не удалось создать группу', error),
      },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Соберите людей по направлениям — и фильтруйте доску по группе одним нажатием.
        Человек может состоять сразу в нескольких группах.
      </p>
      <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
        Прикрепить человека к группе можно и не заходя сюда: на доске выберите его в полосе
        людей и нажмите значок групп, либо откройте карточку человека на странице «Люди».
        А в пригласительной ссылке можно сразу указать группу — новичок попадёт в неё сам.
      </p>

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Название группы
            </label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  create();
                }
              }}
              placeholder="Например: Разработка"
              maxLength={32}
            />
          </div>
          <Button variant="primary" loading={createGroup.isPending} onClick={create}>
            <Plus />
            Создать
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {LABEL_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setColor(item)}
              className={cn(
                'size-6 rounded-full transition-transform',
                color === item && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: item }}
              aria-label={`Цвет ${item}`}
            />
          ))}
        </div>
      </div>

      {board.groups.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="Групп пока нет"
          description="Например: «Разработка», «Тестирование», «Дизайн»."
        />
      ) : (
        <div className="space-y-2">
          {board.groups.map((group) => (
            <GroupRow
              key={group.id}
              board={board}
              group={group}
              onDelete={() => setPendingDelete(group)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Удалить группу «${pendingDelete?.name ?? ''}»?`}
        description="Люди останутся на доске — исчезнет только сама группа и фильтр по ней."
        confirmLabel="Удалить"
        variant="danger"
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteGroup.mutate(pendingDelete.id, {
            onSuccess: () => toast.success('Группа удалена'),
            onError: (error) => toast.error('Не удалось удалить', error),
          });
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function GroupRow({
  board,
  group,
  onDelete,
}: {
  board: BoardDto;
  group: BoardGroupDto;
  onDelete: () => void;
}): React.ReactElement {
  const updateGroup = useUpdateGroup(board.id);
  const setMembers = useSetGroupMembers(board.id);

  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(group.name);
  const [expanded, setExpanded] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const memberIds = new Set(group.members.map((member) => member.id));
  const needle = search.trim().toLowerCase();
  const visibleMembers = needle
    ? board.members.filter(
        (member) =>
          member.user.displayName.toLowerCase().includes(needle) ||
          (member.user.tgUsername ?? '').toLowerCase().includes(needle),
      )
    : board.members;

  const rename = (): void => {
    const trimmed = draftName.trim();
    setEditing(false);
    if (!trimmed || trimmed === group.name) return;
    updateGroup.mutate(
      { groupId: group.id, name: trimmed },
      { onError: (error) => toast.error('Не удалось переименовать', error) },
    );
  };

  const toggleMember = (userId: string): void => {
    const next = memberIds.has(userId)
      ? group.members.filter((member) => member.id !== userId).map((member) => member.id)
      : [...group.members.map((member) => member.id), userId];

    setMembers.mutate(
      { groupId: group.id, userIds: next },
      { onError: (error) => toast.error('Не удалось изменить состав', error) },
    );
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 p-2.5">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />

        {editing ? (
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') rename();
              if (event.key === 'Escape') {
                setDraftName(group.name);
                setEditing(false);
              }
            }}
            maxLength={32}
            className="h-7 max-w-[14rem]"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium"
          >
            {group.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {group.members.length > 0 ? `${group.members.length} чел.` : 'пусто'}
            </span>
          </button>
        )}

        <div className="flex shrink-0 -space-x-1.5">
          {group.members.slice(0, 5).map((member) => (
            <UserAvatar key={member.id} user={member} size="xs" className="ring-2 ring-surface" />
          ))}
          {group.members.length > 5 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-medium ring-2 ring-surface">
              +{group.members.length - 5}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setDraftName(group.name);
            setEditing(true);
          }}
          aria-label={`Переименовать группу ${group.name}`}
        >
          <Pencil />
        </Button>
        <Button
          variant={expanded ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <Users />
          Состав
          <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Удалить группу ${group.name}`}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border p-2">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {LABEL_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() =>
                  updateGroup.mutate(
                    { groupId: group.id, color: item },
                    { onError: (error) => toast.error('Не удалось изменить цвет', error) },
                  )
                }
                className={cn(
                  'size-5 rounded-full transition-transform',
                  group.color === item && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                )}
                style={{ backgroundColor: item }}
                aria-label={`Цвет ${item}`}
              />
            ))}

            <span className="ml-auto text-[11px] text-muted-foreground">
              выбрано: {group.members.length} из {board.members.length}
            </span>
          </div>

          {/* Поиск появляется, когда список перестаёт читаться глазами. */}
          {board.members.length > 8 && (
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти человека"
              icon={<Search />}
              className="mb-1 h-8"
            />
          )}

          <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
            {visibleMembers.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">Никого не нашли</p>
            ) : (
              visibleMembers.map((member) => (
                <label
                  key={member.userId}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-secondary"
                >
                  <Checkbox
                    checked={memberIds.has(member.userId)}
                    onCheckedChange={() => toggleMember(member.userId)}
                  />
                  <UserAvatar user={member.user} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{member.user.displayName}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
