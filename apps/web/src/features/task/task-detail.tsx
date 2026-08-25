import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  PARTICIPANT_ROLE_LABELS,
  type ColumnKey,
  type PresenceUser,
  type RichTextDoc,
  type TaskDetailDto,
} from '@kaif/shared';
import { useBoard } from '@/api/boards';
import {
  useArchiveTask,
  useDeleteTask,
  useDuplicateTask,
  useMoveTask,
  useTaskLinks,
  useTaskMovePending,
  useUpdateTask,
} from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { EMPTY_FILTERS } from '@/stores/ui';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatRelative, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RichTextEditor } from '@/components/rich-text/editor';
import { RichTextViewer } from '@/components/rich-text/viewer';
import { TaskProperties } from './task-properties';
import { TaskComments } from './task-comments';
import { TaskChecklists } from './task-checklists';
import { TaskAttachments } from './task-attachments';
import { BlockedBanner, TaskLinksSection } from './task-links';
import { TaskLinkPicker } from './task-link-picker';
import { TaskActivity } from './task-activity';
import { TaskTypeIcon } from './task-visuals';
import { MoveReasonDialog, type ReasonRequest } from './move-reason-dialog';

/**
 * Карточка задачи целиком.
 *
 * Слева — содержание (описание, чек-листы, файлы, обсуждение),
 * справа — свойства. На узком экране правая колонка уезжает наверх,
 * потому что статус и исполнитель важнее описания при беглом просмотре.
 */
export function TaskDetail({
  task,
  onClose,
  viewers = [],
}: {
  task: TaskDetailDto;
  onClose?: () => void;
  /** Коллеги, открывшие эту же задачу прямо сейчас. */
  viewers?: PresenceUser[];
}): React.ReactElement {
  const currentUser = useAuthStore((state) => state.user);
  const { data: board } = useBoard(task.boardId);
  const updateTask = useUpdateTask(task.id, task.boardId);
  const archiveTask = useArchiveTask(task.id, task.boardId);
  const deleteTask = useDeleteTask(task.id, task.boardId);
  const moveTask = useMoveTask(task.boardId, EMPTY_FILTERS);
  const taskMovePending = useTaskMovePending(task.boardId);
  const duplicateTask = useDuplicateTask(task.id, task.boardId);
  const navigate = useNavigate();

  const [editingTitle, setEditingTitle] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const { createLink, deleteLink } = useTaskLinks(task.id, task.boardId);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [editingDescription, setEditingDescription] = React.useState(false);
  const [description, setDescription] = React.useState<RichTextDoc | null>(task.description);

  /**
   * Добавить картинку в конец описания и сразу открыть его на правку.
   *
   * Дописываем на уровне документа, а не через редактор: когда нажимают
   * кнопку у вложения, редактора на экране ещё нет.
   */
  const insertIntoDescription = React.useCallback(
    (attachment: { url: string; filename: string }): void => {
      setDescription((current) => {
        const base = current ?? task.description ?? { type: 'doc', content: [] };
        return {
          ...base,
          content: [
            ...(base.content ?? []),
            { type: 'image', attrs: { src: attachment.url, alt: attachment.filename } },
          ],
        };
      });
      setEditingDescription(true);
    },
    [task.description],
  );
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [reasonRequest, setReasonRequest] = React.useState<ReasonRequest | null>(null);
  const [pendingColumn, setPendingColumn] = React.useState<ColumnKey | null>(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = React.useState(false);

  React.useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.id, task.title, task.description]);

  React.useEffect(() => setMobileDetailsOpen(false), [task.id]);

  const members = board?.members.map((member) => member.user) ?? [];

  const saveTitle = (): void => {
    const trimmed = title.trim();
    setEditingTitle(false);
    if (trimmed.length < 3 || trimmed === task.title) {
      setTitle(task.title);
      return;
    }
    updateTask.mutate(
      { title: trimmed },
      { onError: (error) => toast.error('Не удалось изменить заголовок', error) },
    );
  };

  const saveDescription = (): void => {
    updateTask.mutate(
      { description },
      {
        onSuccess: () => setEditingDescription(false),
        onError: (error) => toast.error('Не удалось сохранить описание', error),
      },
    );
  };

  /** Смена статуса из карточки — с тем же правилом обязательной причины. */
  const changeColumn = (column: ColumnKey, reason?: string): void => {
    if (taskMovePending) return;

    void moveTask
      .mutateAsync({ taskId: task.id, toColumn: column, ...(reason ? { reason } : {}) })
      .then(() => {
        setReasonRequest(null);
        setPendingColumn(null);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.needsReason && error.reasonRequired) {
          setPendingColumn(column);
          setReasonRequest({
            code: error.reasonRequired.code,
            message: error.reasonRequired.message,
            fromColumn: task.columnKey,
            toColumn: column,
          });
          return;
        }
        toast.error('Не удалось изменить статус', error);
      });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Заголовок ── */}
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <TaskTypeIcon type={task.type} />
            <Link
              to={`/boards/${task.board.key}`}
              className="font-mono font-medium text-primary hover:underline"
            >
              {task.key}
            </Link>
            <span>·</span>
            <span className="truncate">{task.board.name}</span>
            <span>·</span>
            <span>{COLUMN_LABELS[task.columnKey]}</span>
            {task.isBacklog && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">Бэклог</span>
            )}
            {task.isArchived && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                Архив
              </span>
            )}
          </div>

          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveTitle();
                  if (event.key === 'Escape') {
                    setTitle(task.title);
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                className="text-base font-semibold"
              />
              <Button variant="ghost" size="icon-sm" onClick={saveTitle} aria-label="Сохранить">
                <Check />
              </Button>
            </div>
          ) : (
            <h1
              className={cn(
                'text-lg font-semibold leading-tight',
                task.permissions.canUpdate &&
                  'cursor-text rounded px-1 -mx-1 hover:bg-secondary/60',
              )}
              onClick={() => task.permissions.canUpdate && setEditingTitle(true)}
            >
              {task.title}
            </h1>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {viewers.length > 0 && (
            <Tooltip
              content={`Сейчас смотрят: ${viewers.map((viewer) => viewer.displayName).join(', ')}`}
            >
              <div className="mr-1 hidden items-center -space-x-1.5 sm:flex">
                {viewers.slice(0, 3).map((viewer) => (
                  <UserAvatar
                    key={viewer.userId}
                    user={{
                      id: viewer.userId,
                      displayName: viewer.displayName,
                      avatarUrl: viewer.avatarUrl,
                    }}
                    size="sm"
                    ring
                  />
                ))}
              </div>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Действия с задачей">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}/tasks/${task.key}`);
                  toast.success('Ссылка скопирована');
                }}
              >
                <Copy />
                Скопировать ссылку
              </DropdownMenuItem>
              {task.permissions.canUpdate && (
                <DropdownMenuItem onSelect={() => setEditingTitle(true)}>
                  <Pencil />
                  Переименовать
                </DropdownMenuItem>
              )}
              {task.permissions.canUpdate && (
                <DropdownMenuItem
                  onSelect={() =>
                    duplicateTask.mutate(
                      { count: 1 },
                      {
                        onSuccess: (created) => {
                          toast.success('Создана копия', created.key);
                          navigate(`/tasks/${created.key}`);
                        },
                        onError: (error) => toast.error('Не удалось продублировать', error),
                      },
                    )
                  }
                >
                  <CopyPlus />
                  Дублировать
                </DropdownMenuItem>
              )}
              {task.permissions.canArchive && (
                <DropdownMenuItem
                  onSelect={() =>
                    archiveTask.mutate(
                      { archived: !task.isArchived },
                      {
                        onSuccess: () =>
                          toast.success(task.isArchived ? 'Задача возвращена' : 'Задача в архиве'),
                        onError: (error) => toast.error('Не удалось выполнить', error),
                      },
                    )
                  }
                >
                  {task.isArchived ? <ArchiveRestore /> : <Archive />}
                  {task.isArchived ? 'Вернуть из архива' : 'В архив'}
                </DropdownMenuItem>
              )}
              {task.permissions.canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 />
                    Удалить навсегда
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть">
              <X />
            </Button>
          )}
        </div>
      </header>

      {/* ── Содержимое ── */}
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-5">
          {/* Пока держит блокер, браться за задачу бессмысленно —
              говорим об этом первым делом, до описания. */}
          <BlockedBanner task={task} />

          {/* Описание */}
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Описание</h3>
              {task.permissions.canUpdate && !editingDescription && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setEditingDescription(true)}
                >
                  <Pencil />
                  Изменить
                </Button>
              )}
            </div>

            {editingDescription ? (
              <div className="space-y-2">
                <RichTextEditor
                  value={description}
                  onChange={(value) => setDescription(value)}
                  users={members}
                  placeholder="Опишите задачу: что нужно сделать, как проверить результат…"
                  minHeight="160px"
                  uploadTarget={{ taskId: task.id, boardId: task.boardId }}
                  attachments={task.attachments}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={saveDescription}
                    loading={updateTask.isPending}
                  >
                    Сохранить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDescription(task.description);
                      setEditingDescription(false);
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : task.description ? (
              <div
                className={cn(
                  'rounded-lg border border-transparent p-2 -m-2',
                  task.permissions.canUpdate && 'cursor-text hover:border-border',
                )}
                onClick={() => task.permissions.canUpdate && setEditingDescription(true)}
              >
                <RichTextViewer doc={task.description} collapsible />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => task.permissions.canUpdate && setEditingDescription(true)}
                disabled={!task.permissions.canUpdate}
                className="w-full rounded-lg border border-dashed border-border px-3 py-4 text-left text-sm text-muted-foreground hover:bg-secondary/50 disabled:cursor-default"
              >
                Описания нет. Хорошее описание экономит часы переписки.
              </button>
            )}
          </section>

          <TaskChecklists task={task} editable={task.permissions.canUpdate} />
          <TaskAttachments
            task={task}
            editable={task.permissions.canAttach}
            {...(task.permissions.canUpdate
              ? { onInsertIntoDescription: insertIntoDescription }
              : {})}
          />

          {/* Связи — важный блок: что мешает и что ждёт нас. Читается вместе
              с описанием, поэтому стоит здесь, а не только в боковой панели. */}
          <TaskLinksSection
            task={task}
            canManage={task.permissions.canManageLinks}
            onDelete={(linkId) =>
              deleteLink.mutate(linkId, {
                onError: (error: unknown) => toast.error('Не удалось убрать связь', error),
              })
            }
            onAdd={
              task.permissions.canManageLinks ? (
                <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Plus />
                      Связать
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-2">
                    <TaskLinkPicker
                      task={task}
                      loading={createLink.isPending}
                      onSubmit={(type, key) =>
                        createLink.mutate(
                          { type, targetTaskKey: key },
                          {
                            onSuccess: () => setLinkOpen(false),
                            onError: (error: unknown) =>
                              toast.error('Не удалось связать', error),
                          },
                        )
                      }
                    />
                  </PopoverContent>
                </Popover>
              ) : null
            }
          />

          {/* Обсуждение и история */}
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">
                Обсуждение
                {task.commentCount > 0 && (
                  <span className="rounded bg-background/60 px-1 text-[10px]">
                    {task.commentCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history">История</TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="mt-3">
              <TaskComments task={task} members={members} />
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              <TaskActivity taskId={task.id} />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Свойства ── */}
        <aside className="order-first w-full shrink-0 space-y-4 lg:order-none lg:w-80">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 focus-visible:ring-offset-0 lg:hidden"
              onClick={() => setMobileDetailsOpen((open) => !open)}
              aria-expanded={mobileDetailsOpen}
              aria-controls="task-mobile-properties"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <SlidersHorizontal className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Свойства</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {COLUMN_LABELS[task.columnKey]} ·{' '}
                  {task.assignee?.displayName ?? 'без исполнителя'}
                </span>
              </span>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground">
                <ChevronDown
                  className={cn('size-4 transition-transform', mobileDetailsOpen && 'rotate-180')}
                  aria-hidden
                />
              </span>
            </button>

            <div
              id="task-mobile-properties"
              className={cn(
                'border-t border-border p-3 lg:block lg:border-t-0',
                !mobileDetailsOpen && 'hidden lg:block',
              )}
            >
              <TaskProperties
                task={task}
                board={board}
                onMoveColumn={(column) => changeColumn(column as ColumnKey)}
                movePending={taskMovePending}
              />
            </div>
          </div>

          <div
            className={cn(
              'rounded-xl border border-border bg-surface p-3',
              !mobileDetailsOpen && 'hidden lg:block',
            )}
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Участники
            </p>

            {/* Показываем роли явно: по одним аватарам непонятно,
                  кто автор, кто тестирует, а кто просто зашёл в обсуждение. */}
            <ul className="space-y-1.5">
              {task.participants.map((participant) => (
                <li key={participant.user.id} className="flex items-center gap-2 text-sm">
                  <UserAvatar user={participant.user} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{participant.user.displayName}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {participant.roles.map((role) => PARTICIPANT_ROLE_LABELS[role]).join(', ')}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              <p>Создана {formatRelative(task.createdAt)}</p>
              <p>Обновлена {formatRelative(task.updatedAt)}</p>
              {task.completedAt && <p>Завершена {formatRelative(task.completedAt)}</p>}
            </div>
          </div>

          {currentUser?.globalRole === 'SUPERADMIN' && (
            <p
              className={cn(
                'px-1 text-[11px] text-muted-foreground',
                !mobileDetailsOpen && 'hidden lg:block',
              )}
            >
              Вы видите эту задачу как администратор.
            </p>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить задачу навсегда?"
        description="Вместе с задачей исчезнут комментарии, файлы и история. Обычно достаточно архива."
        confirmLabel="Удалить"
        confirmationPhrase={task.key}
        loading={deleteTask.isPending}
        onConfirm={(confirmation) => {
          deleteTask.mutate(confirmation, {
            onSuccess: () => {
              toast.success('Задача удалена');
              setConfirmDelete(false);
              onClose?.();
            },
            onError: (error) => toast.error('Не удалось удалить', error),
          });
        }}
      />

      <MoveReasonDialog
        open={Boolean(reasonRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setReasonRequest(null);
            setPendingColumn(null);
          }
        }}
        request={reasonRequest}
        loading={taskMovePending}
        onSubmit={(reason) => {
          if (pendingColumn) changeColumn(pendingColumn, reason);
        }}
      />
    </div>
  );
}
