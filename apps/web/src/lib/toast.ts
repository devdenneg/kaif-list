import { toast as sonner } from 'sonner';
import { ApiError } from './api';

/**
 * Тосты с единым разбором ошибок API.
 * Пользователь должен видеть человеческую формулировку, а не «500».
 */
export const toast = {
  success: (message: string, description?: string) => sonner.success(message, { description }),

  info: (message: string, description?: string) => sonner(message, { description }),

  warning: (message: string, description?: string) => sonner.warning(message, { description }),

  error: (message: string, error?: unknown) => {
    let description: string | undefined;

    if (error instanceof ApiError) {
      description = error.message;
      if (error.fields) {
        const first = Object.values(error.fields)[0];
        if (first) description = first;
      }
    } else if (error instanceof Error) {
      description = error.message;
    }

    sonner.error(message, { description });
  },

  /** Действие с возможностью отмены — «Задача архивирована · Отменить». */
  undo: (message: string, onUndo: () => void, duration = 8000) =>
    sonner(message, {
      duration,
      action: { label: 'Отменить', onClick: onUndo },
    }),

  promise: sonner.promise,
};
