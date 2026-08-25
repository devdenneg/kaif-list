import type { ApiErrorBody } from '@kaif/shared';

/**
 * HTTP-клиент.
 *
 * Access-токен живёт только в памяти вкладки: при XSS его нельзя «унести»
 * из localStorage, а после перезагрузки страницы он восстанавливается
 * обменом refresh-cookie (HttpOnly, SameSite=Strict).
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const listeners = new Set<(authenticated: boolean) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Подписка на принудительный разлогин (истёкшая или отозванная сессия). */
export function onAuthChange(listener: (authenticated: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitAuthChange(authenticated: boolean): void {
  for (const listener of listeners) listener(authenticated);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly reasonRequired?: { code: string; message: string };
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message || 'Ошибка запроса');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'UNKNOWN';
    if (body.fields) this.fields = body.fields;
    if (body.reasonRequired) this.reasonRequired = body.reasonRequired;
    if (body.requestId) this.requestId = body.requestId;
  }

  /** Операция требует письменного объяснения. */
  get needsReason(): boolean {
    return this.code === 'REASON_REQUIRED';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Не пытаться обновить токен (используется самим обновлением). */
  skipRefresh?: boolean;
  /** FormData для загрузки файлов. */
  formData?: FormData;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      url.searchParams.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      url.searchParams.set(key, value ? 'true' : 'false');
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, body.error ?? { code: 'UNKNOWN', message: 'Ошибка' });
  } catch {
    return new ApiError(response.status, {
      code: 'UNKNOWN',
      message: response.status === 0 ? 'Нет соединения с сервером' : `Ошибка ${response.status}`,
    });
  }
}

/** Обновление пары токенов. Параллельные запросы ждут один и тот же промис. */
export async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(buildUrl('/api/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) {
        setAccessToken(null);
        emitAuthChange(false);
        return false;
      }
      const data = (await response.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      emitAuthChange(true);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const execute = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (!options.formData && options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers,
      ...(options.formData
        ? { body: options.formData }
        : options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };

  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, { code: 'NETWORK', message: 'Нет соединения с сервером' });
  }

  // Токен истёк — обновляем и повторяем запрос ровно один раз.
  if (response.status === 401 && !options.skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await execute();
      } catch {
        throw new ApiError(0, { code: 'NETWORK', message: 'Нет соединения с сервером' });
      }
    } else {
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
  upload: <T>(path: string, formData: FormData, query?: Record<string, unknown>) =>
    apiRequest<T>(path, { method: 'POST', formData, ...(query ? { query } : {}) }),
};
