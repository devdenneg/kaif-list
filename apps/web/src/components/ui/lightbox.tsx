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
  // Последний кадр остаётся смонтированным на время exit-анимации Radix.
  const [lastIndex, setLastIndex] = React.useState<number | null>(index);
  React.useLayoutEffect(() => {
    if (index !== null) setLastIndex(index);
  }, [index]);

  const visibleIndex = index ?? lastIndex;
  const current = visibleIndex !== null ? images[visibleIndex] : undefined;

  React.useEffect(() => {
    if (index === null) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && index < images.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, images.length, onIndexChange]);

  if (visibleIndex === null || !current) return null;

  return (
    <DialogPrimitive.Root open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-sm data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[60] flex flex-col pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] outline-none data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{current.filename}</DialogPrimitive.Title>

          <header className="flex min-w-0 shrink-0 items-center gap-1.5 px-2 py-2 text-white sm:gap-2 sm:px-4 sm:py-3">
            <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
              <span className="block truncate text-sm font-medium">{current.filename}</span>
              <div className="mt-0.5 flex shrink-0 items-center gap-2 text-xs text-white/60 sm:mt-0">
                {current.size !== undefined && (
                  <span className="shrink-0">{formatBytes(current.size)}</span>
                )}
                <span className="shrink-0">
                  {visibleIndex + 1} из {images.length}
                </span>
              </div>
            </div>
            <a
              href={current.url}
              download={current.filename}
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/25"
              aria-label="Скачать"
            >
              <Download className="size-[18px]" />
            </a>
            <DialogPrimitive.Close
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/25"
              aria-label="Закрыть"
            >
              <X className="size-[18px]" />
            </DialogPrimitive.Close>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 sm:px-4 sm:pb-4">
            <img
              key={current.id}
              src={current.url}
              alt={current.filename}
              className="max-h-full max-w-full animate-fade-in rounded-lg object-contain motion-reduce:animate-none"
            />

            <NavButton
              side="left"
              disabled={visibleIndex === 0}
              onClick={() => onIndexChange(visibleIndex - 1)}
            />
            <NavButton
              side="right"
              disabled={visibleIndex === images.length - 1}
              onClick={() => onIndexChange(visibleIndex + 1)}
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
        'absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/45 text-white transition-colors hover:bg-slate-950/65 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/25',
        side === 'left' ? 'left-2 sm:left-4' : 'right-2 sm:right-4',
      )}
    >
      {side === 'left' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </button>
  );
}
