import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

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
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000',
        ws: true,
        changeOrigin: true,
      },
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
