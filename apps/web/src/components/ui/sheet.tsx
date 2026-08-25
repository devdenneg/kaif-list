import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Боковая панель: детали участника, фильтры, уведомления. */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  side?: 'right' | 'left' | 'bottom';
  width?: string;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = 'right', width = 'sm:max-w-md', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col bg-card shadow-popover',
        side === 'right' &&
          cn(
            'inset-y-0 right-0 w-full border-l border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] data-[state=open]:animate-slide-in-right sm:pl-0',
            width,
          ),
        side === 'left' &&
          cn(
            'inset-y-0 left-0 w-full border-r border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] data-[state=open]:animate-slide-in-right sm:pr-0',
            width,
          ),
        side === 'bottom' &&
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] data-[state=open]:animate-slide-in-bottom',
        className,
      )}
      {...props}
    >
      {side === 'bottom' && (
        <div className="flex justify-center pt-2.5" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
      )}
      {children}
      <DialogPrimitive.Close
        className={cn(
          'absolute flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25',
          side === 'bottom'
            ? 'right-[max(0.5rem,env(safe-area-inset-right))] top-2'
            : 'right-[calc(0.5rem+env(safe-area-inset-right))] top-[calc(0.5rem+env(safe-area-inset-top))]',
        )}
        aria-label="Закрыть"
      >
        <X className="size-[18px]" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className={cn('border-b border-border px-4 py-4 pr-12 sm:px-5', className)} {...props} />
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className={cn('scrollbar-thin flex-1 overflow-y-auto p-4 sm:p-5', className)} {...props} />
  );
}
