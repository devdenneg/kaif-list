import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { PublicUser } from '@kaif/shared';
import { cn, colorFromString, initials } from '@/lib/utils';
import { Tooltip } from './tooltip';

const sizeClasses = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-16 text-lg',
  '2xl': 'size-24 text-2xl',
} as const;

export type AvatarSize = keyof typeof sizeClasses;

export interface UserAvatarProps {
  user: Pick<PublicUser, 'id' | 'displayName' | 'avatarUrl'> | null | undefined;
  size?: AvatarSize;
  className?: string;
  /** Показывать имя во всплывающей подсказке. */
  withTooltip?: boolean;
  ring?: boolean;
}

export function UserAvatar({
  user,
  size = 'md',
  className,
  withTooltip = false,
  ring = false,
}: UserAvatarProps): React.ReactElement {
  const name = user?.displayName ?? 'Не назначен';
  const avatar = (
    <AvatarPrimitive.Root
      className={cn(
        'relative isolate inline-flex aspect-square shrink-0 select-none items-center justify-center overflow-hidden rounded-full align-middle leading-none',
        sizeClasses[size],
        ring && 'ring-2 ring-background',
        className,
      )}
    >
      {user?.avatarUrl && (
        <AvatarPrimitive.Image
          src={user.avatarUrl}
          alt={name}
          className="absolute inset-0 block size-full rounded-[inherit] object-cover object-center"
          loading="lazy"
        />
      )}
      <AvatarPrimitive.Fallback
        delayMs={user?.avatarUrl ? 300 : 0}
        className="absolute inset-0 flex size-full items-center justify-center rounded-[inherit] font-semibold text-white"
        style={{ backgroundColor: user ? colorFromString(user.id) : 'hsl(var(--muted))' }}
      >
        {user ? initials(name) : '?'}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );

  return withTooltip ? <Tooltip content={name}>{avatar}</Tooltip> : avatar;
}

export interface AvatarGroupProps {
  users: Pick<PublicUser, 'id' | 'displayName' | 'avatarUrl'>[];
  size?: AvatarSize;
  max?: number;
  className?: string;
  onClick?: () => void;
}

/** Стопка аватаров с «+N» — компактно показывает команду доски. */
export function AvatarGroup({
  users,
  size = 'sm',
  max = 5,
  className,
  onClick,
}: AvatarGroupProps): React.ReactElement {
  const visible = users.slice(0, max);
  const rest = users.length - visible.length;

  return (
    <div
      className={cn('flex items-center -space-x-1.5', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      {visible.map((user) => (
        <UserAvatar key={user.id} user={user} size={size} ring withTooltip />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground ring-2 ring-background',
            sizeClasses[size],
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
