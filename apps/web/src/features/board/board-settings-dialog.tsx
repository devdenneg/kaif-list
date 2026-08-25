import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Crown,
  Layers,
  Palette,
  Settings2,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  BOARD_COLORS,
  COLUMN_LABELS,
  COLUMN_ORDER,
  LABEL_COLORS,
  type BoardDto,
  type BoardSettings,
} from '@kaif/shared';
import {
  useArchiveBoard,
  useCreateLabel,
  useDeleteBoard,
  useDeleteLabel,
  useTransferOwnership,
  useUpdateBoard,
  useUpdateColumn,
} from '@/api/boards';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { Separator, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { LabelChip } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BoardGroupsTab } from './board-groups-tab';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export function BoardSettingsDialog({
  board,
  open,
  onOpenChange,
}: {
  board: BoardDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const updateBoard = useUpdateBoard(board.id);
  const archiveBoard = useArchiveBoard(board.id);
  const deleteBoard = useDeleteBoard(board.id);
  const transferOwnership = useTransferOwnership(board.id);
  const updateColumn = useUpdateColumn(board.id);
  const createLabel = useCreateLabel(board.id);
  const deleteLabel = useDeleteLabel(board.id);

  const [name, setName] = React.useState(board.name);
  const [description, setDescription] = React.useState(board.description ?? '');
  const [color, setColor] = React.useState(board.color);
  const [settings, setSettings] = React.useState<BoardSettings>(board.settings);
  const [newLabel, setNewLabel] = React.useState('');
  const [newOwnerId, setNewOwnerId] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmTransfer, setConfirmTransfer] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(board.name);
    setDescription(board.description ?? '');
    setColor(board.color);
    setSettings(board.settings);
  }, [open, board]);

  const saveGeneral = (): void => {
    updateBoard.mutate(
      { name: name.trim(), description: description.trim() || null, color },
      {
        onSuccess: () => toast.success('Настройки сохранены'),
        onError: (error) => toast.error('Не удалось сохранить', error),
      },
    );
  };

  const saveSettings = (patch: Partial<BoardSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    updateBoard.mutate(
      { settings: patch },
      { onError: (error) => toast.error('Не удалось сохранить правило', error) },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="lg"
          className="max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] sm:max-h-[calc(100dvh-2rem)]"
        >
          <DialogHeader>
            <DialogTitle>Настройки доски</DialogTitle>
          </DialogHeader>

          <DialogBody>
            <Tabs defaultValue="general">
              <TabsList className="scrollbar-thin mb-4 h-auto w-full max-w-full justify-start overflow-x-auto p-1">
                <TabsTrigger value="general" className="shrink-0 [&_svg]:!size-5">
                  <Palette />
                  Общее
                </TabsTrigger>
                <TabsTrigger value="rules" className="shrink-0 [&_svg]:!size-5">
                  <Settings2 />
                  Правила
                </TabsTrigger>
                <TabsTrigger value="labels" className="shrink-0 [&_svg]:!size-5">
                  <Tag />
                  Метки
                </TabsTrigger>
                <TabsTrigger value="groups" className="shrink-0 [&_svg]:!size-5">
                  <Layers />
                  Группы
                </TabsTrigger>
                <TabsTrigger value="danger" className="shrink-0 [&_svg]:!size-5">
                  <AlertTriangle />
                  Опасная зона
                </TabsTrigger>
              </TabsList>

              {/* ── Общее ── */}
              <TabsContent value="general" className="space-y-4">
                <FormField label="Название">
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </FormField>

                <FormField label="Описание">
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={2}
                  />
                </FormField>

                <FormField label="Цвет">
                  <div className="flex flex-wrap gap-2">
                    {BOARD_COLORS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setColor(item)}
                        className="flex size-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:ring-offset-0"
                        aria-label={`Цвет ${item}`}
                        aria-pressed={color === item}
                      >
                        <span
                          className={cn(
                            'size-7 rounded-full',
                            color === item && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
                          )}
                          style={{ backgroundColor: item }}
                          aria-hidden
                        />
                      </button>
                    ))}
                  </div>
                </FormField>

                <FormField
                  label="Ключ"
                  hint="Ключ доски менять нельзя — на нём держатся ссылки на задачи"
                >
                  <Input value={board.key} disabled className="font-mono" />
                </FormField>

                <Button
                  variant="primary"
                  className="w-full xs:w-auto"
                  onClick={saveGeneral}
                  loading={updateBoard.isPending}
                >
                  Сохранить
                </Button>
              </TabsContent>

              {/* ── Правила ── */}
              <TabsContent value="rules" className="space-y-5">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Обязательные объяснения</h3>
                  <p className="text-xs text-muted-foreground">
                    Причина сохраняется в задаче и уходит участникам в Telegram. Это главный
                    инструмент против «задача молча стоит третью неделю».
                  </p>

                  <RuleToggle
                    label="Пауза (On hold)"
                    hint="Нельзя поставить задачу на паузу без объяснения"
                    checked={settings.requireReasonOnHold}
                    onChange={(value) => saveSettings({ requireReasonOnHold: value })}
                  />
                  <RuleToggle
                    label="Возврат назад"
                    hint="Тестировщик возвращает задачу — обязан написать, что не так"
                    checked={settings.requireReasonOnBackwardMove}
                    onChange={(value) => saveSettings({ requireReasonOnBackwardMove: value })}
                  />
                  <RuleToggle
                    label="Перенос дедлайна"
                    hint="Смена уже установленного срока требует причины"
                    checked={settings.requireReasonOnDueDateChange}
                    onChange={(value) => saveSettings({ requireReasonOnDueDateChange: value })}
                  />
                  <RuleToggle
                    label="Смена исполнителя в работе"
                    hint="Если задача уже в работе — объяснить, почему меняется исполнитель"
                    checked={settings.requireReasonOnAssigneeChange}
                    onChange={(value) => saveSettings({ requireReasonOnAssigneeChange: value })}
                  />
                </section>

                <Separator />

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Процесс</h3>
                  <RuleToggle
                    label="Тестировщик обязателен для QA"
                    hint="Не пускать задачу в тестирование, пока не назначен тестировщик"
                    checked={settings.requireTesterForQa}
                    onChange={(value) => saveSettings({ requireTesterForQa: value })}
                  />
                  <RuleToggle
                    label="Не закрывать заблокированные"
                    hint="Задачу с незакрытыми блокерами нельзя перевести в «Завершено»"
                    checked={settings.blockDoneWhenBlocked}
                    onChange={(value) => saveSettings({ blockDoneWhenBlocked: value })}
                  />
                  <RuleToggle
                    label="Взял в работу — стал исполнителем"
                    hint="Автоматически назначать того, кто перевёл задачу в «В работе»"
                    checked={settings.autoAssignOnStart}
                    onChange={(value) => saveSettings({ autoAssignOnStart: value })}
                  />
                  <RuleToggle
                    label="Наблюдатели могут комментировать"
                    checked={settings.allowViewerComments}
                    onChange={(value) => saveSettings({ allowViewerComments: value })}
                  />
                </section>

                <Separator />

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Лимиты одновременной работы (WIP)</h3>
                  </div>
                  <RuleToggle
                    label="Запрещать превышение лимита"
                    hint="Иначе лимит только предупреждает цветом"
                    checked={settings.enforceWipLimits}
                    onChange={(value) => saveSettings({ enforceWipLimits: value })}
                  />

                  <div className="space-y-2">
                    {COLUMN_ORDER.map((column) => {
                      const current = board.columns.find((item) => item.key === column);
                      return (
                        <div
                          key={column}
                          className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2"
                        >
                          <span className="min-w-0 text-sm leading-tight">
                            {COLUMN_LABELS[column]}
                          </span>
                          <Input
                            type="number"
                            min={1}
                            max={999}
                            defaultValue={current?.wipLimit ?? ''}
                            placeholder="без лимита"
                            className="w-full"
                            onBlur={(event) => {
                              const value = event.target.value.trim();
                              updateColumn.mutate({
                                columnKey: column,
                                wipLimit: value === '' ? null : Number(value),
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              </TabsContent>

              {/* ── Метки ── */}
              <TabsContent value="labels" className="space-y-3">
                <div className="flex flex-col gap-2 xs:flex-row">
                  <Input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    placeholder="Название новой метки"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && newLabel.trim()) {
                        createLabel.mutate(
                          {
                            name: newLabel.trim(),
                            color:
                              LABEL_COLORS[board.labels.length % LABEL_COLORS.length] ?? '#6366f1',
                          },
                          { onSuccess: () => setNewLabel('') },
                        );
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    className="w-full xs:w-auto"
                    disabled={!newLabel.trim()}
                    loading={createLabel.isPending}
                    onClick={() =>
                      createLabel.mutate(
                        {
                          name: newLabel.trim(),
                          color:
                            LABEL_COLORS[board.labels.length % LABEL_COLORS.length] ?? '#6366f1',
                        },
                        { onSuccess: () => setNewLabel('') },
                      )
                    }
                  >
                    Добавить
                  </Button>
                </div>

                <div className="space-y-1">
                  {board.labels.map((label) => (
                    <div
                      key={label.id}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                    >
                      <LabelChip name={label.name} color={label.color} className="min-w-0" />
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => deleteLabel.mutate(label.id)}
                          aria-label={`Удалить метку ${label.name}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {board.labels.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">Меток пока нет</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="groups">
                <BoardGroupsTab board={board} />
              </TabsContent>

              {/* ── Опасная зона ── */}
              <TabsContent value="danger" className="space-y-4">
                <div className="rounded-lg border border-border p-3">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                    <Archive className="size-4" />
                    Архив доски
                  </h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Доска станет доступна только на чтение. Данные сохранятся, вернуть можно в любой
                    момент.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full xs:w-auto"
                    loading={archiveBoard.isPending}
                    onClick={() =>
                      archiveBoard.mutate(!board.isArchived, {
                        onSuccess: () =>
                          toast.success(board.isArchived ? 'Доска возвращена' : 'Доска в архиве'),
                      })
                    }
                  >
                    {board.isArchived ? 'Вернуть из архива' : 'Отправить в архив'}
                  </Button>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                    <Crown className="size-4" />
                    Передать владение
                  </h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Новый владелец получит полные права, вы станете администратором.
                  </p>
                  <div className="flex flex-col gap-2 xs:flex-row">
                    <Select value={newOwnerId} onValueChange={setNewOwnerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Выберите участника" />
                      </SelectTrigger>
                      <SelectContent>
                        {board.members
                          .filter((member) => member.userId !== board.ownerId)
                          .map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              <span className="flex items-center gap-2">
                                <UserAvatar user={member.user} size="xs" />
                                {member.user.displayName}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full xs:w-auto"
                      disabled={!newOwnerId}
                      onClick={() => setConfirmTransfer(true)}
                    >
                      Передать
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-destructive">
                    <Trash2 className="size-4" />
                    Удалить доску
                  </h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Вместе с доской исчезнут все задачи, комментарии и файлы. Отменить будет нельзя.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="w-full xs:w-auto"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Удалить доску навсегда
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить доску?"
        description="Все задачи, комментарии, файлы и история будут стёрты безвозвратно."
        confirmLabel="Удалить доску"
        confirmationPhrase={board.key}
        loading={deleteBoard.isPending}
        onConfirm={(confirmation) => {
          deleteBoard.mutate(confirmation, {
            onSuccess: () => {
              toast.success('Доска удалена');
              onOpenChange(false);
              navigate('/boards');
            },
            onError: (error) => toast.error('Не удалось удалить', error),
          });
        }}
      />

      <ConfirmDialog
        open={confirmTransfer}
        onOpenChange={setConfirmTransfer}
        title="Передать владение доской?"
        description="Вы станете администратором и потеряете право удалять доску."
        confirmLabel="Передать"
        variant="primary"
        confirmationPhrase={board.key}
        loading={transferOwnership.isPending}
        onConfirm={(confirmation) => {
          transferOwnership.mutate(
            { newOwnerId, confirm: confirmation },
            {
              onSuccess: () => {
                toast.success('Владелец изменён');
                setConfirmTransfer(false);
              },
              onError: (error) => toast.error('Не удалось передать владение', error),
            },
          );
        }}
      />
    </>
  );
}

function RuleToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors hover:bg-secondary/50">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}
