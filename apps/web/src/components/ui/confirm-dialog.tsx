import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  /**
   * Для необратимых действий: пользователь должен ввести это значение вручную.
   * Так случайное удаление доски или задачи становится невозможным.
   */
  confirmationPhrase?: string;
  onConfirm: (confirmation: string) => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  variant = 'danger',
  loading = false,
  confirmationPhrase,
  onConfirm,
}: ConfirmDialogProps): React.ReactElement {
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (!open) setValue('');
  }, [open]);

  const matches = !confirmationPhrase || value.trim().toUpperCase() === confirmationPhrase.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant === 'danger' && <AlertTriangle className="size-4 text-destructive" />}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {confirmationPhrase && (
          <DialogBody>
            <p className="mb-2 text-sm text-muted-foreground">
              Введите <span className="font-mono font-semibold text-foreground">{confirmationPhrase}</span>{' '}
              для подтверждения:
            </p>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={confirmationPhrase}
              autoFocus
              autoComplete="off"
            />
          </DialogBody>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => void onConfirm(value)}
            disabled={!matches}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
