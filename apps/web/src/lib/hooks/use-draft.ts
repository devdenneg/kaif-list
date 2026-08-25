import * as React from 'react';

/**
 * Черновик, переживающий перезагрузку страницы.
 *
 * Потерять недописанный комментарий из-за случайного закрытия вкладки —
 * мелочь, которая бесит сильнее многих настоящих багов. Храним локально:
 * на сервер незаконченный текст отправлять незачем.
 */
export function useDraft<T>(
  storageKey: string,
  initial: T,
): [T, (value: T) => void, () => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = React.useCallback(
    (next: T) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      // Пишем с задержкой: сохранять на каждое нажатие клавиши незачем.
      timer.current = setTimeout(() => {
        try {
          if (next === null || next === undefined) localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Приватный режим или переполненное хранилище — не повод ломать ввод.
        }
      }, 600);
    },
    [storageKey],
  );

  const clear = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setValue(initial);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // см. выше
    }
  }, [storageKey, initial]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [value, update, clear];
}
