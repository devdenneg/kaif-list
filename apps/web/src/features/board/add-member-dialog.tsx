import * as React from 'react';
import { Search, UserPlus } from 'lucide-react';
import { BoardRole, type BoardDto } from '@kaif/shared';
import { useAddBoardMember } from '@/api/boards';
import { useUsers } from '@/api/users';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/misc';
import { toast } from '@/lib/toast';

export function AddMemberDialog({
  board,
  open,
  onOpenChange,
}: {
  board: BoardDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [search, setSearch] = React.useState('');
  const [role, setRole] = React.useState<BoardRole>(BoardRole.MEMBER);
  const { data: users } = useUsers();
  const addMember = useAddBoardMember(board.id);

  const existing = new Set(board.members.map((member) => member.userId));
  const candidates = (users ?? []).filter(
    (user) =>
      !existing.has(user.id) &&
      (search.trim() === '' ||
        user.displayName.toLowerCase().includes(search.trim().toLowerCase()) ||
        (user.tgUsername ?? '').toLowerCase().includes(search.trim().toLowerCase())),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Добавить участника</DialogTitle>
          <DialogDescription>
            Человек должен быть зарегистрирован — вход происходит через Telegram.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Имя или @username"
              icon={<Search />}
              autoFocus
            />
            <Select value={role} onValueChange={(value) => setRole(value as BoardRole)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BoardRole.ADMIN}>Администратор</SelectItem>
                <SelectItem value={BoardRole.MEMBER}>Участник</SelectItem>
                <SelectItem value={BoardRole.VIEWER}>Наблюдатель</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="scrollbar-thin max-h-72 space-y-0.5 overflow-y-auto">
            {candidates.length === 0 ? (
              <EmptyState
                icon={<UserPlus />}
                title="Некого добавить"
                description="Все подходящие сотрудники уже на доске."
              />
            ) : (
              candidates.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() =>
                    addMember.mutate(
                      { userId: user.id, role },
                      {
                        onSuccess: () => toast.success(`${user.displayName} добавлен(а) на доску`),
                        onError: (error) => toast.error('Не удалось добавить', error),
                      },
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <UserAvatar user={user} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
                  {user.tgUsername && (
                    <span className="shrink-0 text-xs text-muted-foreground">@{user.tgUsername}</span>
                  )}
                  <UserPlus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
