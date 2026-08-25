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

# Образы публичные, поэтому вход в реестр — не обязательное условие.
# Если репозиторий когда-нибудь станет приватным, вход понадобится,
# но падать из-за него сейчас неправильно: выкатка должна пройти.
if [ -n "${GHCR_TOKEN:-}" ] && echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin >/dev/null 2>&1; then
  echo "▸ Вход в реестр выполнен"
  LOGGED_IN=1
else
  echo "▸ Реестр без авторизации (образы публичные)"
  LOGGED_IN=0
fi

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

# На диске всего 10 ГБ, и во время выкатки какое-то время сосуществуют
# старая и новая версии образов. Освобождаем место ДО загрузки, иначе
# `docker compose pull` падает на середине с «no space left on device».
echo "▸ Освобождаю место перед загрузкой"
docker image prune -af >/dev/null 2>&1 || true
AVAILABLE_MB=$(df -Pm /var/lib/docker | awk 'NR==2 {print $4}')
echo "  свободно: ${AVAILABLE_MB} МБ"
if [ "$AVAILABLE_MB" -lt 1200 ]; then
  echo "✗ Меньше 1.2 ГБ свободного места — выкатка остановлена, чтобы не повредить базу" >&2
  exit 1
fi

echo "▸ Загрузка образов"
docker compose pull --quiet

echo "▸ Перезапуск"
# --remove-orphans убирает сервисы, исчезнувшие из compose-файла.
docker compose up -d --remove-orphans

echo "▸ Уборка образов, оставшихся от прошлой версии"
docker image prune -af >/dev/null 2>&1 || true

if [ "$LOGGED_IN" = "1" ]; then
  echo "▸ Выход из реестра"
  docker logout ghcr.io >/dev/null 2>&1 || true
fi

echo "▸ Состояние сервисов"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

echo "▸ Свободная память"
free -h | head -2
