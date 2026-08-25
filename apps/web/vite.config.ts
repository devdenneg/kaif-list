import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Куда локальный дев-сервер проксирует запросы. По умолчанию — продакшен. */
const API_TARGET = process.env.VITE_API_PROXY ?? 'https://45.130.127.31.sslip.io';

/**
 * Прокси на боевой API из локальной разработки.
 *
 * Две вещи, без которых это не работает:
 *
 * 1. **Origin.** Сервер отклоняет мутирующие запросы с чужого источника
 *    (защита от CSRF). Подставляем боевой Origin — так не приходится
 *    ослаблять настройки на самом сервере ради разработки.
 *
 * 2. **Cookie.** Refresh-токен приходит с флагами `Secure` и `SameSite=Strict`.
 *    Браузер не сохранит такую cookie на `http://localhost`, и вход
 *    рассыпался бы на первом же обновлении токена. Снимаем флаги —
 *    только для локального прокси, боевой ответ остаётся нетронутым.
 */
function proxyToApi(ws: boolean) {
  const target = new URL(API_TARGET);
  const secureTarget = target.protocol === 'https:';

  return {
    target: API_TARGET,
    changeOrigin: true,
    ws,
    secure: true,
    headers: secureTarget ? { origin: target.origin } : undefined,
    configure: secureTarget
      ? (proxy: { on: (event: string, handler: (...args: never[]) => void) => void }) => {
          proxy.on('proxyRes', ((_proxyRes: unknown, ...rest: unknown[]) => {
            const response = _proxyRes as { headers: Record<string, string | string[]> };
            void rest;
            const cookies = response.headers['set-cookie'];
            if (!Array.isArray(cookies)) return;
            response.headers['set-cookie'] = cookies.map((cookie) =>
              cookie.replace(/;\s*Secure/gi, '').replace(/SameSite=Strict/gi, 'SameSite=Lax'),
            );
          }) as never);
        }
      : undefined,
  };
}

export default defineConfig(({ mode }) => ({
  // Root задаём явно: сборка запускается и из apps/web, и из корня монорепозитория.
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // Общий пакет подключаем исходниками: мгновенный HMR при правке контрактов.
      '@kaif/shared': path.resolve(root, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Фронт и API живут на одном origin — так же, как в проде за Caddy.
      '/api': proxyToApi(false),
      '/socket.io': proxyToApi(true),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          // @tiptap/pm экспортирует только подпути — как точку входа его брать нельзя.
          editor: ['@tiptap/react', '@tiptap/starter-kit'],
          charts: ['recharts'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/modifiers'],
        },
      },
    },
  },
}));
