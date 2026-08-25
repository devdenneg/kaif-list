import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { BOARD_COLORS, BOARD_KEY_REGEX, LABEL_COLORS, LIMITS } from '@kaif/shared';
import { useCreateBoard } from '@/api/boards';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Создание доски. Ключ подставляется автоматически, но его можно поправить. */
export function CreateBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const createBoard = useCreateBoard();

  const [name, setName] = React.useState('');
  const [key, setKey] = React.useState('');
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [color, setColor] = React.useState<string>(BOARD_COLORS[0] ?? '#6366f1');
  const [groups, setGroups] = React.useState<string[]>([]);
  const [groupDraft, setGroupDraft] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) {
      setName('');
      setKey('');
      setKeyTouched(false);
      setDescription('');
      setGroups([]);
      setGroupDraft('');
      setErrors({});
      setColor(BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)] ?? '#6366f1');
    }
  }, [open]);

  // Пока пользователь не трогал ключ вручную — предлагаем его сами.
  React.useEffect(() => {
    if (keyTouched) return;
    setKey(suggestKey(name));
  }, [name, keyTouched]);

  const addGroup = (): void => {
    const name = groupDraft.trim();
    setGroupDraft('');
    if (!name || groups.length >= 12) return;
    // Две одинаковые группы на доске невозможны — не даём завести их и здесь.
    if (groups.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    setGroups((current) => [...current, name]);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setErrors({});

    if (name.trim().length < LIMITS.boardName.min) {
      setErrors({ name: `Минимум ${LIMITS.boardName.min} символа` });
      return;
    }
    if (key && !BOARD_KEY_REGEX.test(key)) {
      setErrors({ key: 'Ключ: 2–8 латинских букв или цифр, начинается с буквы' });
      return;
    }

    try {
      const board = await createBoard.mutateAsync({
        name: name.trim(),
        ...(key ? { key } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        color,
        ...(groups.length > 0
          ? {
              groups: groups.map((groupName, index) => ({
                name: groupName,
                color: LABEL_COLORS[index % LABEL_COLORS.length] ?? '#6366f1',
              })),
            }
          : {}),
      });
      toast.success('Доска создана', `${board.key} · ${board.name}`);
      onOpenChange(false);
      navigate(`/boards/${board.key}`);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      toast.error('Не удалось создать доску', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Новая доска</DialogTitle>
            <DialogDescription>
              Вы станете её владельцем и сможете настраивать всё: людей, метки, правила.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormField label="Название" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Операционная работа"
                maxLength={LIMITS.boardName.max}
                invalid={Boolean(errors.name)}
                autoFocus
              />
            </FormField>

            <FormField
              label="Ключ"
              hint="Из него растут номера задач: OPS-1, OPS-2. Потом его не изменить."
              error={errors.key}
            >
              <Input
                value={key}
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
                }}
                placeholder="OPS"
                className="font-mono uppercase"
                invalid={Boolean(errors.key)}
              />
            </FormField>

            <FormField label="Описание">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Чем занимается команда на этой доске"
                rows={2}
                maxLength={LIMITS.boardDescription.max}
              />
            </FormField>

            <FormField label="Цвет">
              <div className="flex flex-wrap gap-2">
                {BOARD_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setColor(item)}
                    className={cn(
                      'size-7 rounded-full transition-transform',
                      color === item && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                    )}
                    style={{ backgroundColor: item }}
                    aria-label={`Цвет ${item}`}
                  />
                ))}
              </div>
            </FormField>

            <FormField
              label="Рабочие группы"
              hint="Разработка, тестирование, дизайн. Людей распределите, когда они придут по ссылке."
            >
              <div className="space-y-2">
                {groups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((groupName, index) => (
                      <span
                        key={groupName}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                        style={{
                          borderColor: LABEL_COLORS[index % LABEL_COLORS.length],
                          color: LABEL_COLORS[index % LABEL_COLORS.length],
                        }}
                      >
                        {groupName}
                        <button
                          type="button"
                          onClick={() => setGroups((current) => current.filter((item) => item !== groupName))}
                          aria-label={`Убрать группу ${groupName}`}
                          className="opacity-60 hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <Input
                  value={groupDraft}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    // Enter добавляет группу, а не отправляет форму:
                    // иначе доска создалась бы на полуслове.
                    event.preventDefault();
                    addGroup();
                  }}
                  onBlur={addGroup}
                  placeholder="Название группы и Enter"
                  maxLength={32}
                  disabled={groups.length >= 12}
                />
              </div>
            </FormField>

            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              Доска создаётся только для вас. Людей позовёте пригласительной ссылкой —
              кнопка появится на самой доске.
            </p>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={createBoard.isPending}>
              Создать доску
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TRANSLIT: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'Z', з: 'Z', и: 'I',
  й: 'I', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T',
  у: 'U', ф: 'F', х: 'H', ц: 'C', ч: 'C', ш: 'S', щ: 'S', ъ: '', ы: 'Y', ь: '',
  э: 'E', ю: 'U', я: 'Y',
};

/** Тот же алгоритм, что и на сервере, — чтобы подсказка совпадала с итогом. */
function suggestKey(name: string): string {
  const latin = name
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ');

  const words = latin.split(/\s+/).filter(Boolean);
  let candidate =
    words.length >= 2
      ? words.slice(0, 4).map((word) => word[0] ?? '').join('')
      : (words[0] ?? '').slice(0, 4);

  candidate = candidate.replace(/[^A-Z0-9]/g, '');
  if (/^[0-9]/.test(candidate)) candidate = `B${candidate}`;
  return candidate.slice(0, 6);
}
