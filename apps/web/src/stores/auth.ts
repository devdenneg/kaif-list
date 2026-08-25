import { create } from 'zustand';
import type { CurrentUser } from '@kaif/shared';
import { api, setAccessToken } from '@/lib/api';

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

  /** Восстановление сессии при загрузке страницы по refresh-cookie. */
  bootstrap: async () => {
    try {
      const response = await api.post<{ accessToken: string; user: CurrentUser }>(
        '/api/auth/refresh',
      );
      setAccessToken(response.accessToken);
      set({ status: 'authenticated', user: response.user });
    } catch {
      setAccessToken(null);
      set({ status: 'unauthenticated', user: null });
    }
  },

  refreshUser: async () => {
    try {
      const response = await api.get<{ user: CurrentUser }>('/api/auth/me');
      set({ user: response.user });
    } catch {
      get().clear();
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

export const useCurrentUser = (): CurrentUser | null => useAuthStore((state) => state.user);

export const useIsSuperAdmin = (): boolean =>
  useAuthStore((state) => state.user?.globalRole === 'SUPERADMIN');
