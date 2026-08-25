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
 * перезагрузка страницы, чтобы подтянуть новую версию. Повторная
 * перезагрузка не допускается — иначе при настоящей поломке вкладка
 * уйдёт в вечный цикл.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  name: string,
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (firstError) {
      await new Promise((resolve) => setTimeout(resolve, 400));

      try {
        return await factory();
      } catch (secondError) {
        const key = `kaif:chunk-reload:${name}`;
        const alreadyReloaded = safeSessionGet(key);

        if (!alreadyReloaded) {
          safeSessionSet(key, '1');
          window.location.reload();
          // Страница уже перезагружается — компонент рендерить незачем.
          return new Promise<{ default: T }>(() => undefined);
        }

        void firstError;
        throw secondError;
      }
    }
  });
}

function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Приватный режим — переживём без защиты от повторной перезагрузки.
  }
}

/** Успешная загрузка страницы снимает пометку о перезагрузке. */
export function clearChunkReloadMarks(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('kaif:chunk-reload:')) sessionStorage.removeItem(key);
    }
  } catch {
    // см. выше
  }
}
