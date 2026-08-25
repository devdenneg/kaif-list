#!/usr/bin/env bash
# Выполняется НА СЕРВЕРЕ, скрипт приезжает по SSH из GitHub Actions.
#
# Задача простая: забрать новые образы, перезапустить сервисы и прибрать
# за собой. Всё остальное (секреты, тома, база) остаётся на месте.

set -euo pipefail

APP_DIR=/opt/kaif-board
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "✗ Нет $APP_DIR/.env — секреты не настроены" >&2
  exit 1
fi

echo "▸ Вход в реестр образов"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null

echo "▸ Фиксирую версии образов в .env"
# Записываем теги в .env, а не только в переменные окружения: иначе
# обычный `docker compose ps` или `logs` на сервере падал бы с ошибкой
# «service has neither an image nor a build context».
upsert_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
upsert_env IMAGE_API "$IMAGE_API"
upsert_env IMAGE_BOT "$IMAGE_BOT"
upsert_env IMAGE_WEB "$IMAGE_WEB"

echo "▸ Загрузка образов"
docker compose pull --quiet

echo "▸ Перезапуск"
# --remove-orphans убирает сервисы, исчезнувшие из compose-файла.
docker compose up -d --remove-orphans

echo "▸ Уборка старых образов — на диске всего 6 ГБ"
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true

echo "▸ Выход из реестра"
docker logout ghcr.io >/dev/null 2>&1 || true

echo "▸ Состояние сервисов"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

echo "▸ Свободная память"
free -h | head -2
