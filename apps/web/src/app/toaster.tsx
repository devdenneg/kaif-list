import * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { useUiStore } from '@/stores/ui';

export function Toaster(): React.ReactElement {
  const theme = useUiStore((state) => state.theme);
  return (
    <SonnerToaster
      position="bottom-right"
      theme={theme}
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border shadow-popover',
        },
      }}
      // На мобильных тосты не должны перекрывать нижнюю навигацию.
      offset="16px"
      mobileOffset="80px"
    />
  );
}
