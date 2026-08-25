/**
 * Загружает .env ДО того, как любой модуль обратится к process.env.
 * Импортируется первой строкой в точках входа.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.ENV_FILE,
  path.resolve(process.cwd(), '.env'),
  path.resolve(here, '../../../.env'),
  path.resolve(here, '../../.env'),
].filter((p): p is string => Boolean(p));

for (const candidate of candidates) {
  try {
    if (fs.existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  } catch {
    // Файл может быть недоступен — окружение задано другим способом (Docker, systemd).
  }
}
