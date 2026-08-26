import * as React from 'react';
import {
  ArrowRightLeft,
  CalendarClock,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Reply,
  Send,
  SmilePlus,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  REACTION_EMOJI,
  SOCKET_EVENTS,
  type ColumnKey,
  isEmptyDoc,
  type CommentDto,
  type PublicUser,
  type ReactionEmoji,
  type RichTextDoc,
  type TaskDetailDto,
} from '@kaif/shared';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useToggleReaction,
  useUpdateComment,
} from '@/api/comments';
import { useAuthStore } from '@/stores/auth';
import { getSocket, emitTyping } from '@/lib/socket';
import { formatRelative, formatFullDateTime, cn } from '@/lib/utils';
import { useDraft } from '@/lib/hooks/use-draft';
import { toast } from '@/lib/toast';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RichTextEditor } from '@/components/rich-text/editor';
import { RichTextViewer } from '@/components/rich-text/viewer';

/**
 * Обсуждение задачи.
 *
 * Системные записи (причина возврата, перенос дедлайна) показываются
 * в том же потоке, но визуально отличаются — важно видеть объяснения
 * там же, где идёт разговор, а не в отдельном журнале.
 */
export function TaskComments({
  task,
  members,
}: {
  task: TaskDetailDto;
  members: PublicUser[];
}): React.ReactElement {
  const currentUser = useAuthStore((state) => state.user);
  const { data: comments, isLoading } = useComments(task.id);
  const createComment = useCreateComment(task.id, task.boardId);

  const [draft, setDraft, clearDraft] = useDraft<RichTextDoc | null>(
    `kaif:draft:comment:${task.id}`,
    null,
  );
  const [isEmpty, setIsEmpty] = React.useState(true);
  const [replyTo, setReplyTo] = React.useState<CommentDto | null>(null);
  const [typingUsers, setTypingUsers] = React.useState<string[]>([]);
  const [resetKey, setResetKey] = React.useState(0);

  // «Печатает…» — маленькая деталь, которая сильно оживляет обсуждение.
  React.useEffect(() => {
    const socket = getSocket();
    const handler = (payload: {
      taskId: string;
      userId: string;
      displayName: string;
      typing: boolean;
    }): void => {
      if (payload.taskId !== task.id || payload.userId === currentUser?.id) return;
      setTypingUsers((current) =>
        payload.typing
          ? current.includes(payload.displayName)
            ? current
            : [...current, payload.displayName]
          : current.filter((name) => name !== payload.displayName),
      );
    };
    socket.on(SOCKET_EVENTS.TYPING, handler);
    return () => {
      socket.off(SOCKET_EVENTS.TYPING, handler);
    };
  }, [task.id, currentUser?.id]);

  // Черновик мог восстановиться из хранилища — тогда кнопка «Отправить»
  // должна быть активна сразу, без единого нажатия клавиши.
  React.useEffect(() => {
    if (draft) setIsEmpty(isEmptyDoc(draft));
    // Только при первом появлении черновика — дальше состоянием управляет редактор.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyTyping = (): void => {
    emitTyping(task.id, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(task.id, false), 2500);
  };

  const submit = async (): Promise<void> => {
    if (isEmpty || !draft) return;
    try {
      await createComment.mutateAsync({
        body: draft,
        ...(replyTo ? { parentId: replyTo.id } : {}),
      });
      clearDraft();
      setIsEmpty(true);
      setReplyTo(null);
      setResetKey((key) => key + 1);
      emitTyping(task.id, false);
    } catch (error) {
      toast.error('Не удалось отправить комментарий', error);
    }
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (comments ?? []).length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg bg-background/25 px-3 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <MessageSquareText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Комментариев пока нет</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Оставьте первый комментарий или упомяните коллегу через @.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(comments ?? []).map((comment) => (
            <div key={comment.id} className="space-y-2">
              <CommentItem
                comment={comment}
                taskId={task.id}
                members={members}
                canDelete={
                  comment.author?.id === currentUser?.id || task.permissions.canModerateComments
                }
                onReply={() => setReplyTo(comment)}
              />

              {/* Ответы — с отступом и линией слева: видно, к чему они. */}
              {comment.replies.length > 0 && (
                <div className="ml-3 space-y-2 border-l border-border pl-3 sm:ml-9">
                  {comment.replies.map((reply) => (
                    <CommentItem
                      key={reply.id}
                      comment={reply}
                      taskId={task.id}
                      members={members}
                      canDelete={
                        reply.author?.id === currentUser?.id || task.permissions.canModerateComments
                      }
                      onReply={() => setReplyTo(comment)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-5" aria-live="polite">
        {typingUsers.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex gap-0.5" aria-hidden>
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="size-1 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              ))}
            </span>
            {typingUsers.join(', ')} печатает…
          </p>
        )}
      </div>

      {task.permissions.canComment && (
        <div className="sticky bottom-0 z-10 space-y-2 border-t border-border bg-surface/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1.5 text-xs">
              <Reply className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                Ответ {replyTo.author?.displayName ?? 'на комментарий'}:{' '}
                {replyTo.bodyText.slice(0, 60)}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground [@media(pointer:coarse)]:size-10"
                aria-label="Отменить ответ"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <UserAvatar user={currentUser} size="sm" className="mt-1 hidden sm:flex" />
            <div className="min-w-0 flex-1">
              <RichTextEditor
                key={resetKey}
                value={draft}
                onChange={(value, empty) => {
                  setDraft(value);
                  setIsEmpty(empty);
                  if (!empty) notifyTyping();
                }}
                placeholder="Напишите комментарий…"
                users={members}
                minHeight="64px"
                className="bg-background/60 shadow-none"
                toolbar={false}
                uploadTarget={{ taskId: task.id, boardId: task.boardId }}
                onSubmit={() => void submit()}
              />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="hidden text-[11px] text-muted-foreground sm:inline [@media(pointer:coarse)]:hidden">
                  Enter — отправить, Shift+Enter — перенос строки · картинку можно вставить из
                  буфера
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  className="w-full sm:ml-auto sm:w-auto [@media(pointer:coarse)]:min-h-11"
                  onClick={() => void submit()}
                  disabled={isEmpty}
                  loading={createComment.isPending}
                >
                  <Send />
                  Отправить
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  taskId,
  members,
  canDelete,
  onReply,
}: {
  comment: CommentDto;
  taskId: string;
  members: PublicUser[];
  canDelete: boolean;
  onReply: () => void;
}): React.ReactElement {
  const currentUser = useAuthStore((state) => state.user);
  const updateComment = useUpdateComment(taskId);
  const deleteComment = useDeleteComment(taskId);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<RichTextDoc | null>(comment.body);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  if (comment.kind === 'SYSTEM') return <SystemComment comment={comment} />;

  if (comment.isDeleted) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs italic text-muted-foreground">
        Комментарий удалён
      </div>
    );
  }

  const isOwn = comment.author?.id === currentUser?.id;

  return (
    <div className="group flex gap-2.5">
      <UserAvatar user={comment.author} size="md" className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1 sm:max-w-[75ch]">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {comment.author?.displayName ?? 'Система'}
          </span>
          <Tooltip content={formatFullDateTime(comment.createdAt)}>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelative(comment.createdAt)}
            </span>
          </Tooltip>
          {comment.editedAt && (
            <span className="shrink-0 text-xs text-muted-foreground">(изменён)</span>
          )}

          {/* На сенсорном экране меню нельзя прятать за несуществующий hover. */}
          <div className="ml-auto opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="[@media(pointer:coarse)]:size-10"
                  aria-label="Действия с комментарием"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onReply}>
                  <Reply />
                  Ответить
                </DropdownMenuItem>
                {isOwn && (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil />
                    Редактировать
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 />
                    Удалить
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {editing ? (
          <div className="mt-1 space-y-2">
            <RichTextEditor
              value={draft}
              onChange={(value) => setDraft(value)}
              users={members}
              minHeight="60px"
              toolbar={false}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                className="[@media(pointer:coarse)]:min-h-11"
                loading={updateComment.isPending}
                onClick={() => {
                  if (!draft) return;
                  updateComment.mutate(
                    { commentId: comment.id, body: draft },
                    {
                      onSuccess: () => setEditing(false),
                      onError: (error) => toast.error('Не удалось сохранить', error),
                    },
                  );
                }}
              >
                Сохранить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="[@media(pointer:coarse)]:min-h-11"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(false);
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 rounded-lg bg-secondary/50 px-3 py-2">
            <RichTextViewer doc={comment.body} collapsible />
            {comment.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {comment.attachments.map((attachment) =>
                  attachment.isImage ? (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src={attachment.thumbnailUrl ?? attachment.url}
                        alt={attachment.filename}
                        className="h-20 rounded border border-border object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:items-center"
                    >
                      {attachment.filename}
                    </a>
                  ),
                )}
              </div>
            )}

            <CommentReactions comment={comment} taskId={taskId} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить комментарий?"
        description="Он исчезнет из обсуждения, но след в истории останется."
        confirmLabel="Удалить"
        loading={deleteComment.isPending}
        onConfirm={() => {
          deleteComment.mutate(comment.id, {
            onSuccess: () => setConfirmDelete(false),
            onError: (error) => toast.error('Не удалось удалить', error),
          });
        }}
      />
    </div>
  );
}

/** Системная запись: причина переноса, смены дедлайна или исполнителя. */
function SystemComment({ comment }: { comment: CommentDto }): React.ReactElement {
  const meta = comment.systemMeta;
  const kind = meta?.kind ?? 'OTHER';

  const icon =
    kind === 'MOVE' ? (
      <ArrowRightLeft className="size-3.5" />
    ) : kind === 'DUE_DATE' ? (
      <CalendarClock className="size-3.5" />
    ) : kind === 'ASSIGNEE' ? (
      <UserCog className="size-3.5" />
    ) : (
      <ArrowRightLeft className="size-3.5" />
    );

  const isReturn = meta?.reasonCode === 'MOVE_BACKWARD';
  const isHold = meta?.reasonCode === 'MOVE_ON_HOLD';

  const headline =
    kind === 'MOVE' && meta?.from && meta?.to
      ? `${COLUMN_LABELS[meta.from as ColumnKey] ?? meta.from} → ${COLUMN_LABELS[meta.to as ColumnKey] ?? meta.to}`
      : kind === 'DUE_DATE'
        ? 'Дедлайн изменён'
        : kind === 'ASSIGNEE'
          ? 'Исполнитель изменён'
          : 'Изменение';

  return (
    <div
      className={cn(
        'max-w-[75ch] rounded-lg border px-3 py-2',
        isReturn || isHold ? 'border-warning/40 bg-warning/10' : 'border-border bg-secondary/40',
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1 font-medium',
            isReturn || isHold ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {icon}
          {headline}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="truncate text-muted-foreground">
          {comment.author?.displayName ?? 'Система'}
        </span>
        <Tooltip content={formatFullDateTime(comment.createdAt)}>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {formatRelative(comment.createdAt)}
          </span>
        </Tooltip>
      </div>

      {comment.bodyText && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{comment.bodyText}</p>
      )}
    </div>
  );
}

/**
 * Реакции под комментарием.
 *
 * Короткое «понял» или «👍» не должно становиться отдельным сообщением:
 * обсуждение задачи читают целиком, и десять «ок» подряд делают его бесполезным.
 */
function CommentReactions({
  comment,
  taskId,
}: {
  comment: CommentDto;
  taskId: string;
}): React.ReactElement {
  const toggle = useToggleReaction(taskId);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {comment.reactions.map((reaction) => (
        <Tooltip
          key={reaction.emoji}
          content={reaction.users.map((user) => user.displayName).join(', ')}
        >
          <button
            type="button"
            onClick={() =>
              toggle.mutate({
                commentId: comment.id,
                emoji: reaction.emoji as ReactionEmoji,
              })
            }
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors [@media(pointer:coarse)]:h-10',
              reaction.mine
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border bg-surface text-muted-foreground hover:bg-secondary',
            )}
          >
            <span aria-hidden>{reaction.emoji}</span>
            {reaction.count}
          </button>
        </Tooltip>
      ))}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Добавить реакцию"
            className={cn(
              'inline-flex h-6 items-center rounded-full border border-border bg-surface px-2 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:px-0',
              comment.reactions.length === 0 &&
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
            )}
          >
            <SmilePlus className="size-3.5" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-auto p-1.5" align="start">
          <div className="flex gap-0.5 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:grid-cols-4">
            {REACTION_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  toggle.mutate({ commentId: comment.id, emoji });
                  setPickerOpen(false);
                }}
                className="rounded-md p-1.5 text-lg transition-transform hover:scale-125 hover:bg-secondary [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:p-0"
                aria-label={`Реакция ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
