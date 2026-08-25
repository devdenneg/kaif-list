import * as React from 'react';
import { AlertTriangle, MessageSquareWarning } from 'lucide-react';
import { COLUMN_LABELS, LIMITS, type ColumnKey } from '@kaif/shared';
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
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ReasonRequest {
  code: string;
  message: string;
  fromColumn?: ColumnKey;
  toColumn?: ColumnKey;
}

/**
 * Обязательное объяснение.
 *
 * Ядро процесса: задачу нельзя молча поставить на паузу, вернуть назад
 * или подвинуть дедлайн. Причина уходит в историю задачи и участникам
 * в Telegram — именно ради этого продукт и затевался.
 */
export function MoveReasonDialog({
  open,
  onOpenChange,
  request,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ReasonRequest | null;
  loading?: boolean;
  onSubmit: (reason: string) => void;
}): React.ReactElement {
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < LIMITS.reason.min;
  const valid = trimmed.length >= LIMITS.reason.min;

  const hint = React.useMemo(() => {
    switch (request?.code) {
      case 'MOVE_ON_HOLD':
        return 'Что именно блокирует задачу? Кого или чего ждём?';
      case 'MOVE_BACKWARD':
        return 'Что не так? Опишите шаги воспроизведения или чего не хватает.';
      case 'DUE_DATE_CHANGED':
        return 'Почему срок сдвигается? Что помешало успеть?';
      case 'ASSIGNEE_CHANGED':
        return 'Почему меняется исполнитель?';
      default:
        return 'Коротко объясните причину.';
    }
  }, [request?.code]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareWarning className="size-4 text-warning" />
            Нужно объяснение
          </DialogTitle>
          <DialogDescription>{request?.message ?? 'Опишите причину изменения'}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {request?.fromColumn && request.toColumn && (
            <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <span className="text-muted-foreground">{COLUMN_LABELS[request.fromColumn]}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{COLUMN_LABELS[request.toColumn]}</span>
            </div>
          )}

          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={hint}
            rows={4}
            maxLength={LIMITS.reason.max}
            invalid={tooShort}
            autoFocus
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid) {
                onSubmit(trimmed);
              }
            }}
          />

          <div className="flex items-center justify-between text-xs">
            <span className={cn('text-muted-foreground', tooShort && 'text-destructive')}>
              {tooShort
                ? `Ещё ${LIMITS.reason.min - trimmed.length} символов`
                : 'Причина сохранится в истории задачи и уйдёт участникам'}
            </span>
            <span className="text-muted-foreground">
              {trimmed.length}/{LIMITS.reason.max}
            </span>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Без объяснения изменение не будет применено — так устроен процесс.
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => onSubmit(trimmed)}
            disabled={!valid}
            loading={loading}
          >
            Подтвердить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
