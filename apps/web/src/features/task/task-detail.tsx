import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlignLeft,
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
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 sm:p-4 lg:flex-row lg:justify-center lg:gap-5 lg:p-5">
        <div className="min-w-0 flex-1 space-y-4 lg:max-w-[52rem]">
          {/* Пока держит блокер, браться за задачу бессмысленно —
              говорим об этом первым делом, до описания. */}
          <BlockedBanner task={task} />

          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/40">
            {/* Описание */}
            <section className="p-4 sm:p-5">
              <div className="mb-3 flex min-h-9 items-center gap-2">
                <AlignLeft className="size-4 text-muted-foreground" aria-hidden />
                <h3 className="text-sm font-semibold">Описание</h3>
                {task.permissions.canUpdate && !editingDescription && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto -mr-2"
                    onClick={() => setEditingDescription(true)}
                  >
                    <Pencil />
                    Изменить
                  </Button>
                )}
              </div>

              {editingDescription ? (
                <div className="space-y-3">
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
                  <div className="flex flex-wrap gap-2">
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
                <div className="max-w-[75ch]">
                  <RichTextViewer doc={task.description} collapsible />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => task.permissions.canUpdate && setEditingDescription(true)}
                  disabled={!task.permissions.canUpdate}
                  className="w-full rounded-lg border border-dashed border-border bg-background/25 px-3 py-3 text-left transition-colors hover:bg-secondary/45 focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-default disabled:hover:bg-background/25"
                >
                  <span className="block text-sm font-medium text-foreground/90">
                    Описание не добавлено
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {task.permissions.canUpdate
                      ? 'Укажите ожидаемый результат и как его проверить.'
                      : 'Здесь пока нет дополнительного контекста.'}
                  </span>
                </button>
              )}
            </section>

            <div className="p-4 sm:p-5">
              <TaskChecklists task={task} editable={task.permissions.canUpdate} />
            </div>

            <div className="p-4 sm:p-5">
              <TaskAttachments
                task={task}
                editable={task.permissions.canAttach}
                {...(task.permissions.canUpdate
                  ? { onInsertIntoDescription: insertIntoDescription }
                  : {})}
              />
            </div>

            {/* Связи — важный блок: что мешает и что ждёт нас. Читается вместе
                с описанием, поэтому стоит здесь, а не только в боковой панели. */}
            {(task.links.length > 0 || task.permissions.canManageLinks) && (
              <div className="p-4 sm:p-5">
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
              </div>
            )}
          </div>

          {/* Обсуждение и история */}
          <Tabs
            defaultValue="comments"
            className="overflow-hidden rounded-xl border border-border bg-surface/40"
          >
            <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
              <h3 className="text-sm font-semibold">Активность</h3>
              <TabsList
                className="h-10 w-full rounded-lg bg-secondary/70 p-1 sm:ml-auto sm:w-auto"
                aria-label="Активность задачи"
              >
                <TabsTrigger value="comments" className="min-w-0 flex-1 sm:flex-none">
                  Обсуждение
                  {task.commentCount > 0 && (
                    <span className="min-w-5 rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums">
                      {task.commentCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history" className="min-w-0 flex-1 sm:flex-none">
                  История
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="comments" className="m-0 p-3 sm:p-4">
              <TaskComments task={task} members={members} />
            </TabsContent>

            <TabsContent value="history" className="m-0 p-3 sm:p-4">
              <TaskActivity taskId={task.id} />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Свойства ── */}
        <aside className="order-first w-full shrink-0 lg:order-none lg:w-80">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 focus-visible:ring-offset-0 lg:hidden"
              onClick={() => setMobileDetailsOpen((open) => !open)}
              aria-expanded={mobileDetailsOpen}
              aria-controls="task-mobile-properties task-mobile-secondary-properties"
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
                  className={cn(
                    'size-4 transition-transform duration-200 ease-out motion-reduce:transition-none',
                    mobileDetailsOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </span>
            </button>

            <div
              id="task-mobile-properties"
              className={cn(
                'grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none lg:visible lg:grid-rows-[1fr] lg:opacity-100',
                mobileDetailsOpen
                  ? 'visible grid-rows-[1fr] opacity-100'
                  : 'invisible grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="border-t border-border p-3 lg:border-t-0">
                  <TaskProperties
                    task={task}
                    board={board}
                    onMoveColumn={(column) => changeColumn(column as ColumnKey)}
                    movePending={taskMovePending}
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            id="task-mobile-secondary-properties"
            className={cn(
              'grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none lg:visible lg:grid-rows-[1fr] lg:opacity-100',
              mobileDetailsOpen
                ? 'visible grid-rows-[1fr] opacity-100'
                : 'invisible grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pt-4">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Участники
                  </p>

                  {/* Показываем роли явно: по одним аватарам непонятно,
                    кто автор, кто тестирует, а кто просто зашёл в обсуждение. */}
                  <ul className="space-y-1.5">
                    {task.participants.map((participant) => (
                      <li key={participant.user.id} className="flex items-center gap-2 text-sm">
                        <UserAvatar user={participant.user} size="sm" />
                        <span className="min-w-0 flex-1 truncate">
                          {participant.user.displayName}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {participant.roles
                            .map((role) => PARTICIPANT_ROLE_LABELS[role])
                            .join(', ')}
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
                  <p className="px-1 pt-4 text-[11px] text-muted-foreground">
                    Вы видите эту задачу как администратор.
                  </p>
                )}
              </div>
            </div>
          </div>
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
