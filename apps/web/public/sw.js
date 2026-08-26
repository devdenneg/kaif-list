/**
 * Сервис-воркер: минимальный и намеренно консервативный.
 *
 * Правила:
 *  - API и WebSocket никогда не кешируются (иначе можно увидеть чужие или
 *    устаревшие данные — это хуже, чем отсутствие офлайна);
 *  - файлы из /assets/ имеют хеш в имени, поэтому отдаются из кеша сразу;
 *  - навигация идёт сначала в сеть, и только при её отсутствии — из кеша.
 *    Так пользователь не застревает на старой версии приложения.
 */

/**
 * Версия берётся из адреса регистрации: /sw.js?v=<идентификатор сборки>.
 * Без этого имя кеша было бы постоянным, старые файлы оставались бы
 * навсегда, а вкладка могла получить оболочку от предыдущей версии.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `kaif-${VERSION}`;
const APP_SHELL = '/index.html';

/**
 * Новая версия НЕ вытесняет старую немедленно.
 *
 * Раньше здесь были skipWaiting и clients.claim: свежий воркер перехватывал
 * управление у уже открытой вкладки и тут же удалял её кеш. Вкладка
 * продолжала просить файлы предыдущей сборки — их уже не было ни в кеше,
 * ни на сервере, — страница не грузилась и уходила на перезагрузку.
 * В Safari это превращалось в бесконечный цикл.
 *
 * Теперь новый воркер ждёт, пока старые вкладки закроются. Оболочка всё
 * равно берётся из сети при каждом переходе, так что застрять на старой
 * версии нельзя.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([APP_SHELL])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
});

/** Страница может попросить воркер уступить место — например перед обновлением. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;

  // Ассеты с хешем в имени неизменяемы — отдаём из кеша.
  // Ищем по всем кешам, а не только по текущему: вкладка, открытая до
  // выкатки, продолжает просить файлы прошлой сборки, и отдать их
  // из старого кеша — единственный способ не сломать ей навигацию.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Навигация: сначала сеть, при офлайне — сохранённая оболочка приложения.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(APP_SHELL, copy));
          return response;
        })
        .catch(() => caches.match(APP_SHELL).then((cached) => cached ?? Response.error())),
    );
  }
});
