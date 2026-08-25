import * as React from 'react';
import { Check, Plus, Tag } from 'lucide-react';
import { LABEL_COLORS, type LabelDto } from '@kaif/shared';
import { useCreateLabel } from '@/api/boards';
import { Button } from '@/components/ui/button';
import { Input, useFormFieldA11y } from '@/components/ui/input';
import { LabelChip } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Выбор меток с возможностью создать новую прямо на месте. */
export function LabelPicker({
  boardId,
  labels,
  selectedIds,
  onChange,
  canCreate,
  disabled,
  triggerClassName,
  ariaLabel,
}: {
  boardId: string;
  labels: LabelDto[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  canCreate: boolean;
  disabled?: boolean;
  triggerClassName?: string;
  ariaLabel?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const formField = useFormFieldA11y();
  const createLabel = useCreateLabel(boardId);

  const filtered = labels.filter((label) =>
    label.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const exactExists = labels.some(
    (label) => label.name.toLowerCase() === search.trim().toLowerCase(),
  );

  const toggle = (labelId: string): void => {
    onChange(
      selectedIds.includes(labelId)
        ? selectedIds.filter((id) => id !== labelId)
        : [...selectedIds, labelId],
    );
  };

  const create = async (): Promise<void> => {
    const name = search.trim();
    if (name.length === 0) return;
    try {
      const color = LABEL_COLORS[labels.length % LABEL_COLORS.length] ?? '#6366f1';
      const label = await createLabel.mutateAsync({ name, color });
      onChange([...selectedIds, label.id]);
      setSearch('');
    } catch (error) {
      toast.error('Не удалось создать метку', error);
    }
  };

  const selected = labels.filter((label) => selectedIds.includes(label.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          id={formField?.controlId}
          aria-labelledby={formField?.labelId}
          aria-describedby={formField?.descriptionId}
          aria-required={formField?.required || undefined}
          aria-label={ariaLabel}
          className={cn(
            'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors [@media(pointer:coarse)]:min-h-11',
            disabled ? 'cursor-default opacity-70' : 'hover:bg-secondary',
            triggerClassName,
          )}
        >
          {selected.length === 0 ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Tag className="size-4" />
              Нет меток
            </span>
          ) : (
            selected.map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-0" align="start">
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти или создать"
            inheritFormFieldA11y={false}
            aria-label="Поиск меток"
            className="h-8 [@media(pointer:coarse)]:h-11"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canCreate && !exactExists && search.trim()) {
                event.preventDefault();
                void create();
              }
            }}
          />
        </div>

        <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto p-1">
          {filtered.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => toggle(label.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary [@media(pointer:coarse)]:min-h-11"
            >
              <LabelChip name={label.name} color={label.color} />
              {selectedIds.includes(label.id) && (
                <Check className="ml-auto size-4 shrink-0 text-primary" />
              )}
            </button>
          ))}

          {filtered.length === 0 && !search && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Меток пока нет</p>
          )}
        </div>

        {canCreate && search.trim() && !exactExists && (
          <div className="border-t border-border p-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start [@media(pointer:coarse)]:min-h-11"
              onClick={() => void create()}
              loading={createLabel.isPending}
            >
              <Plus />
              Создать «{search.trim()}»
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
