import * as React from 'react';

/**
 * Ленивая загрузка страницы, устойчивая к выкатке новой версии.
 *
 * Имена файлов сборки содержат хеш. Когда выходит новая версия, старые
 * файлы исчезают — и вкладка, открытая до выкатки, при переходе на другую
 * страницу получает «Failed to fetch dynamically imported module».
 * Пользователь при этом не сделал ничего плохого и не понимает, что делать.
 *
 * Поэтому: одна повторная попытка (вдруг сеть моргнула), затем одна
 * перезагрузка — уже с очисткой кеша, иначе Safari отдаст ту же самую
 * страницу со ссылками на исчезнувшие файлы, и всё повторится.
 *
 * Защита от вечного цикла двойная: пометка на конкретную страницу и общий
 * потолок перезагрузок за сессию. Одной пометки мало — цикл может гулять
 * по разным страницам.
 */

const MARK_PREFIX = 'kaif:chunk-reload:';
const BUDGET_KEY = 'kaif:chunk-reload-budget';
/** Больше двух перезагрузок подряд не помогают: дело не в кеше. */
const MAX_RELOADS = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  name: string,
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const loaded = await factory();
      // Страница открылась — значит, если её когда-то перезагружали из-за
      // пропавшего файла, пометку можно снять. Именно здесь, а не при
      // старте приложения: иначе пометка стирается ещё до попытки
      // загрузить страницу и перестаёт защищать от цикла.
      clearMark(name);
      return loaded;
    } catch (firstError) {
      await new Promise((resolve) => setTimeout(resolve, 400));

      try {
        const loaded = await factory();
        clearMark(name);
        return loaded;
      } catch (secondError) {
        if (canReload(name)) {
          markReloaded(name);
          await hardReload();
          // Страница уже перезагружается — компонент рендерить незачем.
          return new Promise<{ default: T }>(() => undefined);
        }

        void firstError;
        throw secondError;
      }
    }
  });
}

function canReload(name: string): boolean {
  if (safeGet(`${MARK_PREFIX}${name}`)) return false;
  return spentReloads() < MAX_RELOADS;
}

function markReloaded(name: string): void {
  safeSet(`${MARK_PREFIX}${name}`, '1');
  safeSet(BUDGET_KEY, String(spentReloads() + 1));
}

function spentReloads(): number {
  const raw = Number(safeGet(BUDGET_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function clearMark(name: string): void {
  try {
    sessionStorage.removeItem(`${MARK_PREFIX}${name}`);
  } catch {
    // Приватный режим — переживём без защиты от повторной перезагрузки.
  }
}

/**
 * Перезагрузка, которая действительно приносит новую версию.
 *
 * Обычный reload в Safari отдаёт ту же страницу из кеша, вместе со ссылками
 * на файлы, которых на сервере уже нет, — и вкладка уходит в цикл. Поэтому
 * сначала убираем сервис-воркер и его кеш, потом идём по адресу заново.
 */
async function hardReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Не получилось прибраться — всё равно перезагружаемся.
  }

  window.location.reload();
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // см. выше
  }
}
