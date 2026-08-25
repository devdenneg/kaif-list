import * as React from 'react';
import { cn } from '@/lib/utils';

export function FullScreenLoader({ inline = false }: { inline?: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        inline ? 'min-h-[50dvh] w-full' : 'min-h-dvh w-full bg-background',
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="relative size-10">
          <div className="absolute inset-0 rounded-full border-2 border-secondary" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    </div>
  );
}
