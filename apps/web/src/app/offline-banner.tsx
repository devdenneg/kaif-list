import * as React from 'react';
import { WifiOff } from 'lucide-react';

/** Явный индикатор потери сети: иначе «ничего не сохраняется» выглядит как баг. */
export function OfflineBanner(): React.ReactElement | null {
  const [online, setOnline] = React.useState(() => navigator.onLine);

  React.useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-xs font-medium text-warning-foreground">
      <WifiOff className="size-3.5" />
      Нет соединения с сервером — изменения не сохраняются
    </div>
  );
}
