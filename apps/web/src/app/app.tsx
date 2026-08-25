import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/app/toaster';
import { queryClient } from '@/lib/query-client';
import { router } from '@/app/router';
import { useAuthStore } from '@/stores/auth';
import { applyTheme, useUiStore } from '@/stores/ui';
import { onAuthChange } from '@/lib/api';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@kaif/shared';
import { AppErrorBoundary } from '@/app/error-boundary';
import { clearChunkReloadMarks } from '@/lib/lazy-with-retry';
import { OfflineBanner } from '@/app/offline-banner';

export function App(): React.ReactElement {
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const clear = useAuthStore((state) => state.clear);
  const status = useAuthStore((state) => state.status);
  const theme = useUiStore((state) => state.theme);

  // Восстанавливаем сессию по refresh-cookie до первого рендера страниц.
  React.useEffect(() => {
    void bootstrap();
    // Приложение поднялось — значит, прошлая перезагрузка из-за
    // недостающего файла сборки помогла и пометку можно снять.
    clearChunkReloadMarks();
  }, [bootstrap]);

  React.useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => applyTheme(useUiStore.getState().theme);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  // Сервер отозвал сессию — выходим и чистим кеш.
  React.useEffect(
    () =>
      onAuthChange((authenticated) => {
        if (!authenticated) {
          clear();
          queryClient.clear();
          disconnectSocket();
        }
      }),
    [clear],
  );

  React.useEffect(() => {
    if (status === 'authenticated') connectSocket();
    else disconnectSocket();
  }, [status]);

  /**
   * «Выйти на всех устройствах» должно срабатывать сразу, а не через 15 минут,
   * когда протухнет access-токен.
   *
   * Сервер не знает, какая вкладка какую сессию держит, поэтому он просто
   * сообщает «сессия отозвана», а вкладка проверяет себя одним запросом:
   * если отозвали именно её — запрос вернёт 401 и клиент разлогинится сам.
   */
  React.useEffect(() => {
    if (status !== 'authenticated') return;
    const socket = getSocket();
    const onRevoked = (): void => {
      void useAuthStore.getState().refreshUser();
    };
    socket.on(SOCKET_EVENTS.SESSION_REVOKED, onRevoked);
    return () => {
      socket.off(SOCKET_EVENTS.SESSION_REVOKED, onRevoked);
    };
  }, [status]);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          <OfflineBanner />
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
