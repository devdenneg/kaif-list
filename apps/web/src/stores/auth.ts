import { create } from 'zustand';
import type { CurrentUser } from '@kaif/shared';
import { ApiError, api, apiRequest, isSessionLost, setAccessToken } from '@/lib/api';

/**
 * Состояние авторизации.
 *
 * `status` разделяет три разных «нет пользователя»: ещё не проверяли,
 * проверили и не авторизован, авторизован. Без этого разделения на старте
 * приложения мигает экран входа.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  setSession: (accessToken: string, user: CurrentUser) => void;
  setUser: (user: CurrentUser) => void;
  clear: () => void;
  bootstrap: () => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  setSession: (accessToken, user) => {
    setAccessToken(accessToken);
    set({ status: 'authenticated', user });
  },

  setUser: (user) => set({ user }),

  clear: () => {
    setAccessToken(null);
    set({ status: 'unauthenticated', user: null });
  },

  /**
   * Восстановление сессии при загрузке страницы по refresh-cookie.
   *
   * Экран входа показываем, только если сервер прямо сказал, что сессии нет.
   * Недоступный сервер (выкатка, 502 от прокси, пропавшая сеть) — это не
   * «вы не авторизованы»: кука цела, и через несколько секунд всё поднимется.
   * Поэтому при таких ошибках повторяем попытку, а не выбрасываем человека.
   */
  bootstrap: async () => {
    const delaysMs = [0, 700, 2_000, 5_000];

    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      if (delaysMs[attempt]) await sleep(delaysMs[attempt] as number);

      try {
        // skipRefresh: это и есть обновление, второй заход бессмысленен.
        const response = await apiRequest<{ accessToken: string; user: CurrentUser }>(
          '/api/auth/refresh',
          { method: 'POST', skipRefresh: true },
        );
        setAccessToken(response.accessToken);
        set({ status: 'authenticated', user: response.user });
        return;
      } catch (error) {
        if (error instanceof ApiError && isSessionLost(error)) {
          setAccessToken(null);
          set({ status: 'unauthenticated', user: null });
          return;
        }
        // Иначе пробуем ещё раз.
      }
    }

    // Сервер так и не ответил. Кука на месте, поэтому обычная перезагрузка
    // страницы вернёт человека в аккаунт — просто показываем вход.
    setAccessToken(null);
    set({ status: 'unauthenticated', user: null });
  },

  refreshUser: async () => {
    try {
      const response = await api.get<{ user: CurrentUser }>('/api/auth/me');
      set({ user: response.user });
    } catch {
      // Молча. Раньше любая ошибка здесь означала выход — включая моргнувшую
      // сеть. Решение о выходе принимает только обновление токена: если сессии
      // действительно нет, оно само сообщит об этом приложению.
    }
  },

  logout: async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      get().clear();
    }
  },
}));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useCurrentUser = (): CurrentUser | null => useAuthStore((state) => state.user);

export const useIsSuperAdmin = (): boolean =>
  useAuthStore((state) => state.user?.globalRole === 'SUPERADMIN');
