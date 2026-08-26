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
let renewAt = 0;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(authenticated: boolean) => void>();

/**
 * Токен обновляется заранее, а не по факту отказа.
 *
 * Иначе первый клик после паузы упирается в истёкший токен: пользователь
 * жмёт «в архив» и читает «срок действия токена истёк» — притом что он
 * ничего не нарушал, а под капотом всё поправимо. Обновляем на 80% срока
 * жизни, и до отказа дело просто не доходит.
 */
const RENEW_AT_FRACTION = 0.8;

export function setAccessToken(token: string | null, expiresInSeconds?: number): void {
  accessToken = token;

  if (renewTimer) {
    clearTimeout(renewTimer);
    renewTimer = null;
  }

  if (!token || !expiresInSeconds) {
    renewAt = 0;
    return;
  }

  const lifetimeMs = expiresInSeconds * 1000;
  renewAt = Date.now() + lifetimeMs * RENEW_AT_FRACTION;

  // Вкладка может спать — таймер не сработает вовремя, поэтому есть ещё
  // проверка при возвращении на вкладку и перед каждым запросом.
  renewTimer = setTimeout(() => {
    void refreshSession();
  }, Math.max(5_000, lifetimeMs * RENEW_AT_FRACTION));
}

/** Пора ли обновлять токен. */
function isStale(): boolean {
  return Boolean(accessToken) && renewAt > 0 && Date.now() >= renewAt;
}

if (typeof document !== 'undefined') {
  // Вернулись на вкладку после паузы — проверяем токен до того, как человек
  // что-нибудь нажмёт.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isStale()) void refreshSession();
  });
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

/**
 * Обновление пары токенов.
 *
 * Разлогинивать человека можно только тогда, когда сервер прямо сказал:
 * сессии больше нет. Всё остальное — недоступный сервер при выкатке, 502 от
 * прокси, лимит частоты, пропавшая сеть в метро — это временно, и кука цела.
 * Раньше любой такой ответ отправлял человека на экран входа, хотя выходить
 * он не собирался.
 *
 * Параллельные запросы ждут один и тот же промис.
 */
/** Сервер сказал прямо: сессии больше нет. Всё остальное — временные помехи. */
export function isSessionLost(error: ApiError): boolean {
  if (error.status !== 401 && error.status !== 403) return false;
  return SESSION_LOST_CODES.has(error.code);
}

const SESSION_LOST_CODES = new Set([
  'SESSION_NOT_FOUND',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'TOKEN_REUSE',
  'USER_INACTIVE',
  'NO_REFRESH_TOKEN',
]);

export async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = attemptRefresh(0).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function attemptRefresh(attempt: number): Promise<boolean> {
  try {
    const response = await fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });

    if (response.ok) {
      const data = (await response.json()) as { accessToken: string; expiresIn?: number };
      setAccessToken(data.accessToken, data.expiresIn);
      emitAuthChange(true);
      return true;
    }

    // Сервер отказал по существу — сессии действительно нет.
    if (response.status === 401 || response.status === 403) {
      const error = await parseError(response);
      if (SESSION_LOST_CODES.has(error.code)) {
        setAccessToken(null);
        emitAuthChange(false);
        return false;
      }
    }

    // 429, 5xx, обрыв связи — сессия жива, дело в помехе. Пробуем ещё
    // пару раз: иначе человек увидит отказ на действии, которое просто
    // не дождалось обновления токена.
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return attemptRefresh(attempt + 1);
    }
    return false;
  } catch {
    if (attempt < 2) {
    await sleep(400 * (attempt + 1));
    return attemptRefresh(attempt + 1);
    }
    // Сеть пропала. Это не повод считать человека вышедшим.
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Токен вот-вот истечёт — обновляем до отправки, а не после отказа.
  if (!options.skipRefresh && isStale()) await refreshSession();

  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, { code: 'NETWORK', message: 'Нет соединения с сервером' });
  }

  // Всё-таки отказ по токену — обновляем и повторяем. Две попытки: между
  // первой и второй мог пройти чужой обмен токена в соседней вкладке.
  for (let attempt = 0; response.status === 401 && !options.skipRefresh && attempt < 2; attempt += 1) {
    const refreshed = await refreshSession();
    if (!refreshed) break;
    try {
      response = await execute();
    } catch {
      throw new ApiError(0, { code: 'NETWORK', message: 'Нет соединения с сервером' });
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
