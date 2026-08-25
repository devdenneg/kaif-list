import * as React from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface State {
  error: Error | null;
}

/**
 * Последний рубеж: любая необработанная ошибка рендера показывает
 * понятный экран вместо белого листа.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Ошибка интерфейса:', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-card">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertOctagon className="size-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Что-то сломалось</h1>
            <p className="text-sm text-muted-foreground">
              Интерфейс не смог отрисоваться. Обновите страницу — обычно этого достаточно.
            </p>
          </div>
          <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <Button variant="primary" onClick={() => window.location.reload()} className="w-full">
            <RotateCcw />
            Обновить страницу
          </Button>
        </div>
      </div>
    );
  }
}
