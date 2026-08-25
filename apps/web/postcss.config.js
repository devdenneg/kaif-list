import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Путь до конфигурации Tailwind задаём абсолютным: сборка запускается
// и из apps/web, и из корня монорепозитория (в Docker-образе — из корня).
const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.join(here, 'tailwind.config.ts') },
    autoprefixer: {},
  },
};
