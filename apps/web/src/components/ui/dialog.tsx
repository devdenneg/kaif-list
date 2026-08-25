import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/lib/hooks/use-media-query';

/**
 * Модальное окно. На телефоне превращается в bottom-sheet:
 * так до кнопок дотягивается большой палец, а закрытие — свайпом вниз
 * привычнее, чем поиск крестика в углу.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm',
      'data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  hideClose?: boolean;
  /** Не превращать в bottom-sheet на мобильных (например, для полноэкранных форм). */
  forceDialog?: boolean;
}

const sizeClasses: Record<NonNullable<DialogContentProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(1100px,95vw)]',
};

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = 'md', hideClose, forceDialog, ...props }, ref) => {
  const isMobile = useIsMobile();
  const asSheet = isMobile && !forceDialog;

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-card text-card-foreground shadow-popover',
          asSheet
            ? 'inset-x-0 bottom-0 max-h-[94dvh] rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] data-[state=open]:animate-slide-in-bottom'
            : cn(
                'left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border',
                sizeClasses[size],
                forceDialog
                  ? 'data-[state=open]:animate-fade-in sm:data-[state=open]:animate-dialog-in'
                  : 'data-[state=open]:animate-dialog-in',
              ),
          className,
        )}
        {...props}
      >
        {asSheet && (
          <div className="flex justify-center pt-2.5" aria-hidden>
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-2 flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25',
              asSheet ? 'right-[max(0.5rem,env(safe-area-inset-right))]' : 'right-2',
            )}
            aria-label="Закрыть"
          >
            <X className="size-[18px]" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 border-b border-border px-4 py-4 pr-12 sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold leading-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

export function DialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5', className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-5',
        className,
      )}
      {...props}
    />
  );
}
