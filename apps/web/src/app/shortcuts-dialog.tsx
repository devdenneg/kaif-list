import * as React from 'react';
import { Keyboard } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Справка по горячим клавишам.
 *
 * Сочетания бесполезны, если о них никто не знает: вызывается по «?»,
 * как принято в инструментах, где клавиатурой пользуются всерьёз.
 */
const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Навигация',
    items: [
      { keys: ['⌘', 'K'], label: 'Поиск задач, досок и людей' },
      { keys: ['/'], label: 'То же самое, без модификатора' },
      { keys: ['?'], label: 'Эта справка' },
      { keys: ['Esc'], label: 'Закрыть окно или отменить действие' },
    ],
  },
  {
    title: 'На доске',
    items: [
      { keys: ['C'], label: 'Создать задачу' },
      { keys: ['ПКМ'], label: 'Меню быстрых действий на карточке' },
      { keys: ['Долгий тап'], label: 'Взять карточку на телефоне' },
    ],
  },
  {
    title: 'В задаче',
    items: [
      { keys: ['⌘', '↵'], label: 'Отправить комментарий' },
      { keys: ['⌘', 'V'], label: 'Вставить скриншот из буфера' },
      { keys: ['@'], label: 'Упомянуть коллегу' },
      { keys: ['↵'], label: 'Сохранить заголовок при редактировании' },
    ],
  },
  {
    title: 'В быстром добавлении',
    items: [
      { keys: ['↵'], label: 'Создать задачу и остаться в форме' },
      { keys: ['⇧', '↵'], label: 'Перенос строки' },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" />
            Горячие клавиши
          </DialogTitle>
          <DialogDescription>
            На Windows и Linux вместо ⌘ используйте Ctrl.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center gap-3 text-sm">
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 text-muted-foreground">{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
