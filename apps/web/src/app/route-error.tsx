import * as React from 'react';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { AlertOctagon, ChevronDown, Copy, Home, RotateCcw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Экран ошибки маршрута.
 *
 * Пользователь не должен видеть стек-трейс: он ничего ему не говорит и
 * выглядит как поломка всего продукта. Показываем понятную причину и
 * действие, которое обычно помогает, а технические подробности прячем
 * под раскрывающийся блок — они нужны, когда об ошибке сообщают в поддержку.
 */
export function RouteError(): React.ReactElement {
  const error = useRouteError();
  const navigate = useNavigate();
  const [expanded, setExpanded] = React.useState(false);

  const details = describeError(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              details.tone === 'network'
                ? 'bg-warning/15 text-warning'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {details.tone === 'network' ? (
              <WifiOff className="size-5" />
            ) : (
              <AlertOctagon className="size-5" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight">{details.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{details.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RotateCcw />
            Обновить страницу
          </Button>
          <Button variant="outline" onClick={() => navigate('/boards')}>
            <Home />К доскам
          </Button>
        </div>

        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60"
            aria-expanded={expanded}
          >
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-200 motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
            Технические подробности
            <span className="ml-auto font-mono">{details.code}</span>
          </button>

          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
              expanded
                ? 'grid-rows-[1fr] opacity-100'
                : 'pointer-events-none grid-rows-[0fr] opacity-0',
            )}
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="border-t border-border p-3">
                <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {details.technical}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(details.technical)
                      .then(() => toast.success('Скопировано', 'Отправьте это администратору'))
                      .catch(() => toast.error('Не удалось скопировать'));
                  }}
                >
                  <Copy />
                  Скопировать
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ErrorDetails {
  title: string;
  description: string;
  code: string;
  technical: string;
  tone: 'error' | 'network';
}

function describeError(error: unknown): ErrorDetails {
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);

  // Ответ сервера на уровне маршрута (404, 403 и т. п.).
  if (isRouteErrorResponse(error)) {
    return {
      title: error.status === 404 ? 'Страница не найдена' : 'Запрос отклонён',
      description:
        error.status === 404
          ? 'Возможно, ссылка устарела или объект удалили.'
          : 'Сервер отказал в доступе к этой странице.',
      code: `HTTP ${error.status}`,
      technical: `${error.status} ${error.statusText}\n${JSON.stringify(error.data, null, 2)}`,
      tone: 'error',
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  // Самая частая ошибка в проде: вкладка открыта со старой версией,
  // а файлы новой сборки лежат под другими именами.
  if (
    /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message)
  ) {
    return {
      title: 'Вышла новая версия',
      description:
        'Страница была открыта до обновления. Нажмите «Обновить» — всё вернётся на место, данные не потеряются.',
      code: 'CHUNK',
      technical: stack,
      tone: 'network',
    };
  }

  if (/NetworkError|Failed to fetch|ERR_INTERNET/i.test(message)) {
    return {
      title: 'Нет связи с сервером',
      description: 'Проверьте интернет и попробуйте обновить страницу.',
      code: 'NETWORK',
      technical: stack,
      tone: 'network',
    };
  }

  // React #185 и подобные — ошибка в самом приложении.
  const reactError = /Minified React error #(\d+)/.exec(message);
  if (reactError) {
    return {
      title: 'Что-то сломалось в интерфейсе',
      description:
        'Мы уже знаем об ошибке. Обновите страницу — обычно этого достаточно, чтобы продолжить работу.',
      code: `REACT-${reactError[1]}`,
      technical: stack,
      tone: 'error',
    };
  }

  return {
    title: 'Что-то пошло не так',
    description: 'Обновите страницу. Если повторится — пришлите подробности администратору.',
    code: 'UNKNOWN',
    technical: stack,
    tone: 'error',
  };
}
