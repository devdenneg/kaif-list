import { useEffect, useRef } from 'react';

type Handler = (event: KeyboardEvent) => void;

/**
 * Горячие клавиши.
 *
 * Две особенности, без которых сочетания работают только у половины команды:
 *
 * 1. **Раскладка.** На русской раскладке `event.key` для клавиши C — это «с»,
 *    и биндинг `c` просто не сработает. Поэтому сочетание проверяется и по
 *    символу, и по физической клавише (`event.code`).
 * 2. **Символы с Shift.** «?» набирается через Shift, поэтому сочетание
 *    сверяется и с модификатором, и без него.
 *
 * Внутри полей ввода обычные клавиши игнорируются — иначе набор текста
 * превращался бы в лотерею. Сочетания с Cmd/Ctrl работают везде.
 */
export function useHotkeys(bindings: Record<string, Handler>, enabled = true): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        target?.getAttribute('role') === 'textbox';

      const withModifier = event.metaKey || event.ctrlKey;
      if (isEditable && !withModifier) return;

      const prefix: string[] = [];
      if (withModifier) prefix.push('mod');
      if (event.altKey) prefix.push('alt');

      // Физическая клавиша: KeyC → c, Digit7 → 7, Slash → /.
      const physical = event.code
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .toLowerCase();

      const candidates = new Set<string>();
      for (const key of [event.key.toLowerCase(), physical]) {
        if (!key) continue;
        candidates.add([...prefix, key].join('+'));
        if (event.shiftKey) candidates.add([...prefix, 'shift', key].join('+'));
      }

      for (const combo of candidates) {
        const handlerFn = ref.current[combo];
        if (handlerFn) {
          event.preventDefault();
          handlerFn(event);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
