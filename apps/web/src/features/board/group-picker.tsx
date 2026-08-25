import * as React from 'react';
import { Check, Layers, Plus } from 'lucide-react';
import type { BoardDto } from '@kaif/shared';
import { useCreateGroup, useSetMemberGroups } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Группы одного человека: галочки и строка «создать новую».
 *
 * Один и тот же список нужен в трёх местах — в панели участника, в полосе
 * людей над доской и на странице «Люди», — поэтому живёт отдельным
 * компонентом. Прикрепить человека к группе можно там же, где на него
 * смотрят, а не только в настройках доски.
 */
export function GroupPickerMenu({
  board,
  userId,
  canManage,
  trigger,
  align = 'end',
}: {
  board: BoardDto;
  userId: string;
  canManage: boolean;
  trigger: React.ReactNode;
  align?: 'start' | 'end';
}): React.ReactElement {
  const setMemberGroups = useSetMemberGroups(board.id);
  const createGroup = useCreateGroup(board.id);
  const [newName, setNewName] = React.useState('');

  const current = board.groups
    .filter((group) => group.members.some((member) => member.id === userId))
    .map((group) => group.id);

  const toggle = (groupId: string): void => {
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId];

    setMemberGroups.mutate(
      { userId, groupIds: next },
      { onError: (error) => toast.error('Не удалось изменить группы', error) },
    );
  };

  const create = (): void => {
    const name = newName.trim();
    if (!name) return;
    createGroup.mutate(
      { name, userIds: [userId] },
      {
        onSuccess: (group) => {
          toast.success(`Группа «${group.name}» создана`);
          setNewName('');
        },
        onError: (error) => toast.error('Не удалось создать группу', error),
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="w-60">
        <DropdownMenuLabel>Рабочие группы</DropdownMenuLabel>

        {board.groups.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {canManage
              ? 'Групп пока нет — заведите первую прямо здесь.'
              : 'На этой доске ещё нет рабочих групп.'}
          </p>
        )}

        {board.groups.map((group) => {
          const active = current.includes(group.id);
          return (
            <DropdownMenuItem
              key={group.id}
              disabled={!canManage}
              onSelect={(event) => {
                event.preventDefault();
                toggle(group.id);
              }}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {group.members.length}
              </span>
              <Check className={cn('size-3.5 shrink-0', !active && 'invisible')} />
            </DropdownMenuItem>
          );
        })}

        {canManage && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1 p-1">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  // Внутри меню Enter выбирает пункт — гасим это поведение.
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    create();
                  }
                }}
                placeholder="Новая группа"
                maxLength={32}
                className="h-7 text-xs"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={create}
                disabled={!newName.trim()}
                loading={createGroup.isPending}
                aria-label="Создать группу и добавить человека"
              >
                <Plus />
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Компактный ряд групп человека. Показываем всем, меняет — управляющий. */
export function MemberGroupChips({
  board,
  userId,
  className,
}: {
  board: BoardDto;
  userId: string;
  className?: string;
}): React.ReactElement | null {
  const groups = board.groups.filter((group) =>
    group.members.some((member) => member.id === userId),
  );
  if (groups.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <Layers className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      {groups.map((group) => (
        <span
          key={group.id}
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
          style={{ borderColor: group.color, color: group.color }}
        >
          {group.name}
        </span>
      ))}
    </div>
  );
}
