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

echo "▸ Загрузка образов"
export IMAGE_API IMAGE_BOT IMAGE_WEB
docker compose pull --quiet

echo "▸ Перезапуск"
# --remove-orphans убирает сервисы, исчезнувшие из compose-файла.
docker compose up -d --remove-orphans

echo "▸ Запоминаю версию (пригодится для отката)"
cat > .current-images <<VERSIONS
IMAGE_API=$IMAGE_API
IMAGE_BOT=$IMAGE_BOT
IMAGE_WEB=$IMAGE_WEB
VERSIONS

echo "▸ Уборка старых образов — на диске всего 6 ГБ"
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true

echo "▸ Выход из реестра"
docker logout ghcr.io >/dev/null 2>&1 || true

echo "▸ Состояние сервисов"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

echo "▸ Свободная память"
free -h | head -2
