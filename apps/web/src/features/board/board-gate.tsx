import * as React from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, Search } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { FullScreenLoader } from '@/app/loader';

/**
 * Экран, пока доска не загрузилась.
 *
 * Раньше любая неудача показывала «Доска не найдена, возможно её удалили».
 * Но чаще всего доска на месте, а не долетел один запрос: сеть моргнула,
 * контейнер перезапускался при выкатке, обновлялся токен. Человек читал,
 * что у него отобрали доступ, и шёл разбираться — на пустом месте.
 *
 * Теперь «не найдена» говорится, только если сервер прямо это ответил.
 * Всё остальное — «не удалось загрузить» с кнопкой повторить.
 */
export function BoardGate({
  loading,
  error,
  onRetry,
  retrying,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}): React.ReactElement {
  if (loading) return <FullScreenLoader inline />;

  if (isBoardMissing(error)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Search />}
          title="Доска не найдена"
          description="Возможно, её удалили или у вас больше нет доступа."
          action={
            <Button variant="primary" asChild>
              <Link to="/boards">К списку досок</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <EmptyState
        icon={<CloudOff />}
        title="Не удалось загрузить доску"
        description={describe(error)}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={onRetry} loading={retrying}>
              Повторить
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/boards">К списку досок</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** Сервер прямо сказал, что доски нет или доступа к ней больше нет. */
export function isBoardMissing(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 403 && error.code !== 'BOARD_ARCHIVED';
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Нет связи с сервером. Проверьте соединение и попробуйте снова.';
    if (error.status === 429) return 'Слишком много запросов подряд. Подождите несколько секунд.';
    if (error.status >= 500) return 'Сервер сейчас недоступен — возможно, идёт обновление.';
  }
  return 'Похоже, запрос не долетел. Попробуйте ещё раз.';
}
