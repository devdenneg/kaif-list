import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        'glass-floating z-50 max-w-xs origin-[var(--radix-tooltip-content-transform-origin)] rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-popover',
        '[--kaif-floating-x:0px] [--kaif-floating-y:-4px] data-[side=left]:[--kaif-floating-x:4px] data-[side=left]:[--kaif-floating-y:0px] data-[side=right]:[--kaif-floating-x:-4px] data-[side=right]:[--kaif-floating-y:0px] data-[side=top]:[--kaif-floating-y:4px]',
        'data-[state=delayed-open]:animate-floating-in data-[state=instant-open]:animate-floating-in data-[state=closed]:animate-floating-out',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/** Короткая обёртка: подсказка одной строкой, без бойлерплейта. */
export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 400,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}): React.ReactElement {
  if (!content) return <>{children}</>;
  return (
    <TooltipRoot delayDuration={delay}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipRoot>
  );
}
