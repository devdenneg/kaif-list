import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Link2Off, LogIn, Users } from 'lucide-react';
import { BOARD_ROLE_LABELS } from '@kaif/shared';
import { useAcceptInvite, useInvitePreview } from '@/api/invites';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/misc';
import { FullScreenLoader } from '@/app/loader';
import { toast } from '@/lib/toast';

/**
 * Экран приглашения: `/invite/<токен>`.
 *
 * Человек видит, куда его зовут и кто зовёт, — и только потом вступает.
 * Автоматически в доску не добавляем: переход по ссылке из чата не должен
 * незаметно менять состав доски.
 */
export function InvitePage(): React.ReactElement {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data: invite, isLoading, error } = useInvitePreview(token);
  const acceptInvite = useAcceptInvite();

  if (isLoading) return <FullScreenLoader inline />;

  if (error || !invite) {
    return (
      <div className="mx-auto max-w-md p-6">
        <EmptyState
          icon={<Link2Off />}
          title="Ссылка недействительна"
          description="Приглашение истекло, было отозвано или уже использовано. Попросите новое у владельца доски."
          action={
            <Button variant="primary" onClick={() => navigate('/boards')}>
              К моим доскам
            </Button>
          }
        />
      </div>
    );
  }

  const join = (): void => {
    if (!token) return;
    acceptInvite.mutate(token, {
      onSuccess: (result) => {
        toast.success(
          result.alreadyMember ? 'Вы уже участник этой доски' : 'Добро пожаловать на доску',
        );
        navigate(`/boards/${result.boardKey}`);
      },
      onError: (error) => toast.error('Не удалось вступить', error),
    });
  };

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <span
          className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl text-xl font-bold text-white"
          style={{ backgroundColor: invite.boardColor }}
          aria-hidden
        >
          {invite.boardKey.slice(0, 2)}
        </span>

        <h1 className="text-lg font-semibold tracking-tight">{invite.boardName}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-3.5" />
          участников: {invite.memberCount}
        </p>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
          <UserAvatar user={invite.invitedBy} size="sm" />
          <span className="min-w-0">
            <span className="font-medium">{invite.invitedBy.displayName}</span> приглашает вас
            с ролью «{BOARD_ROLE_LABELS[invite.role]}»
          </span>
        </div>

        <Button
          variant="primary"
          className="mt-5 w-full"
          loading={acceptInvite.isPending}
          onClick={join}
        >
          {invite.alreadyMember ? <ArrowRight /> : <LogIn />}
          {invite.alreadyMember ? 'Открыть доску' : 'Присоединиться'}
        </Button>

        <button
          type="button"
          onClick={() => navigate('/boards')}
          className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Не сейчас
        </button>
      </div>
    </div>
  );
}
