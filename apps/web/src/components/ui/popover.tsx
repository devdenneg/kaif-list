import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        'glass-floating z-50 w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-lg border border-border p-3 text-popover-foreground shadow-popover outline-none',
        '[--kaif-floating-x:0px] [--kaif-floating-y:-4px] data-[side=left]:[--kaif-floating-x:4px] data-[side=left]:[--kaif-floating-y:0px] data-[side=right]:[--kaif-floating-x:-4px] data-[side=right]:[--kaif-floating-y:0px] data-[side=top]:[--kaif-floating-y:4px]',
        'data-[state=open]:animate-floating-in data-[state=closed]:animate-floating-out',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';
