import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';

export interface LightboxImage {
  id: string;
  url: string;
  filename: string;
  size?: number;
}

/**
 * Просмотр изображений.
 *
 * Скриншоты в задачах открывают чаще, чем любое другое вложение, и уводить
 * человека в новую вкладку ради этого — лишний шаг. Стрелки и Esc работают,
 * потому что смотреть серию скриншотов подряд — обычное дело.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const current = index !== null ? images[index] : undefined;

  React.useEffect(() => {
    if (index === null) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && index < images.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, images.length, onIndexChange]);

  if (index === null || !current) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[60] flex flex-col outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{current.filename}</DialogPrimitive.Title>

          <header className="flex items-center gap-3 px-4 py-3 text-white">
            <span className="min-w-0 flex-1 truncate text-sm">{current.filename}</span>
            {current.size !== undefined && (
              <span className="shrink-0 text-xs text-white/60">{formatBytes(current.size)}</span>
            )}
            <span className="shrink-0 text-xs text-white/60">
              {index + 1} из {images.length}
            </span>
            <a
              href={current.url}
              download={current.filename}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Скачать"
            >
              <Download className="size-4" />
            </a>
            <DialogPrimitive.Close
              className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Закрыть"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
            <img
              src={current.url}
              alt={current.filename}
              className="max-h-full max-w-full rounded-lg object-contain"
            />

            <NavButton
              side="left"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
            />
            <NavButton
              side="right"
              disabled={index === images.length - 1}
              onClick={() => onIndexChange(index + 1)}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}): React.ReactElement | null {
  if (disabled) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Предыдущее' : 'Следующее'}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      {side === 'left' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </button>
  );
}
