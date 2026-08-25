import * as React from 'react';
import { Check, Search, UserX } from 'lucide-react';
import type { BoardMemberDto, PublicUser } from '@kaif/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Выбор человека из участников доски: исполнитель, тестировщик, наблюдатель. */
export function UserPicker({
  members,
  value,
  onChange,
  placeholder = 'Не назначен',
  allowEmpty = true,
  disabled,
  align = 'start',
  triggerClassName,
}: {
  members: BoardMemberDto[];
  value: PublicUser | null;
  onChange: (userId: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  align?: 'start' | 'end' | 'center';
  triggerClassName?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const filtered = members.filter((member) =>
    member.user.displayName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  React.useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            disabled ? 'cursor-default opacity-70' : 'hover:bg-secondary',
            triggerClassName,
          )}
        >
          <UserAvatar user={value} size="sm" />
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
            {value?.displayName ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-64 p-0">
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск"
            icon={<Search />}
            className="h-8"
            autoFocus
          />
        </div>

        <div className="scrollbar-thin max-h-64 overflow-y-auto p-1">
          {allowEmpty && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-secondary">
                <UserX className="size-3.5" />
              </span>
              Не назначен
              {!value && <Check className="ml-auto size-4 text-primary" />}
            </button>
          )}

          {filtered.map((member) => (
            <button
              key={member.userId}
              type="button"
              onClick={() => {
                onChange(member.userId);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
            >
              <UserAvatar user={member.user} size="sm" />
              <span className="min-w-0 flex-1 truncate">{member.user.displayName}</span>
              {value?.id === member.userId && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Никого не найдено</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
