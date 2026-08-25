import * as React from 'react';
import { Check, Copy, Link2, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { BoardRole, type BoardDto, type BoardInviteDto } from '@kaif/shared';
import { useBoardInvites, useCreateInvite, useRevokeInvite } from '@/api/invites';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserAvatar } from '@/components/ui/avatar';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';

/** Radix Select не умеет пустое значение — нужен явный маркер «без группы». */
const NO_GROUP = 'none';

const ROLE_OPTIONS = [
  { value: BoardRole.MEMBER, label: 'Участник', hint: 'Работает с задачами' },
  { value: BoardRole.VIEWER, label: 'Наблюдатель', hint: 'Только смотрит и комментирует' },
  { value: BoardRole.ADMIN, label: 'Администратор', hint: 'Управляет доской и людьми' },
];

const LIFETIME_OPTIONS = [
  { value: '1', label: '1 день' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
];

const USES_OPTIONS = [
  { value: '1', label: 'Один человек' },
  { value: '10', label: 'До 10 человек' },
  { value: 'unlimited', label: 'Без ограничения' },
];

/**
 * Приглашение на доску по ссылке.
 *
 * Список всех, кто зарегистрирован в системе, наружу не отдаётся: кого звать,
 * решает владелец, а не факт наличия аккаунта. Поэтому единственный способ
 * добавить человека — передать ему ссылку лично.
 */
export function InviteDialog({
  board,
  open,
  onOpenChange,
}: {
  board: BoardDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { data: invites, isLoading } = useBoardInvites(board.id, open);
  const createInvite = useCreateInvite(board.id);
  const revokeInvite = useRevokeInvite(board.id);

  const [role, setRole] = React.useState<BoardRole>(BoardRole.MEMBER);
  const [lifetime, setLifetime] = React.useState('7');
  const [uses, setUses] = React.useState('10');
  const [groupId, setGroupId] = React.useState<string>(NO_GROUP);

  const create = (): void => {
    createInvite.mutate(
      {
        role,
        expiresInDays: Number(lifetime),
        maxUses: uses === 'unlimited' ? null : Number(uses),
        groupId: groupId === NO_GROUP ? null : groupId,
      },
      {
        onSuccess: (invite) => {
          void copyLink(invite.url);
          toast.success('Ссылка создана и скопирована', 'Отправьте её человеку в личном чате');
        },
        onError: (error) => toast.error('Не удалось создать ссылку', error),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Пригласить в доску</DialogTitle>
          <DialogDescription>
            Человек войдёт через Telegram и сразу окажется на доске «{board.name}».
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Роль">
              <Select value={role} onValueChange={(value) => setRole(value as BoardRole)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Срок жизни">
              <Select value={lifetime} onValueChange={setLifetime}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIFETIME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Сколько входов">
              <Select value={uses} onValueChange={setUses}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USES_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {board.groups.length > 0 && (
            <FormField
              label="Сразу в группу"
              hint="Кто войдёт по этой ссылке, окажется в выбранной группе."
            >
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                  {board.groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: group.color }}
                          aria-hidden
                        />
                        {group.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <Button
            variant="primary"
            className="w-full"
            loading={createInvite.isPending}
            onClick={create}
          >
            <Plus />
            Создать ссылку
          </Button>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Действующие ссылки
            </p>

            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Загружаем
              </div>
            ) : (invites ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                Активных ссылок нет. Создайте — и отправьте человеку в Telegram.
              </p>
            ) : (
              (invites ?? []).map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  onRevoke={() =>
                    revokeInvite.mutate(invite.id, {
                      onSuccess: () => toast.success('Ссылка отозвана'),
                      onError: (error) => toast.error('Не удалось отозвать', error),
                    })
                  }
                />
              ))
            )}
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            Ссылка — это ключ от доски. Отправляйте её лично и отзывайте, когда она
            больше не нужна.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function InviteRow({
  invite,
  onRevoke,
}: {
  invite: BoardInviteDto;
  onRevoke: () => void;
}): React.ReactElement {
  const [copied, setCopied] = React.useState(false);

  const copy = (): void => {
    void copyLink(invite.url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
      <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{invite.url}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>{ROLE_OPTIONS.find((item) => item.value === invite.role)?.label ?? invite.role}</span>
          {invite.group && (
            <>
              <span>·</span>
              <span style={{ color: invite.group.color }}>{invite.group.name}</span>
            </>
          )}
          <span>·</span>
          <span>
            {invite.maxUses === null
              ? `входов: ${invite.useCount}`
              : `использовано ${invite.useCount} из ${invite.maxUses}`}
          </span>
          <span>·</span>
          <span>до {formatDateTime(invite.expiresAt)}</span>
        </p>
      </div>

      <UserAvatar user={invite.createdBy} size="xs" />

      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Скопировать ссылку">
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRevoke}
        aria-label="Отозвать ссылку"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** Буфер обмена доступен не везде (http, старый Safari) — тогда честно говорим об этом. */
async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    toast.error('Не удалось скопировать', 'Выделите ссылку и скопируйте вручную');
    return false;
  }
}
