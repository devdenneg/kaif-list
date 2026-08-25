#!/usr/bin/env bash
# Резервное копирование базы и загруженных файлов.
# Запускать по cron на VPS:
#   17 3 * * * /opt/kaif-board/deploy/backup.sh >> /var/log/kaif-backup.log 2>&1
#
# Восстановление:
#   gunzip -c backups/db-2026-03-10.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# shellcheck disable=SC1091
set -a; source .env; set +a

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F_%H%M)"
COMPOSE="docker compose -f docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Резервное копирование базы…"
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip -9 > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[$(date -Is)] Резервное копирование файлов…"
$COMPOSE run --rm --no-deps -T \
  -v "$BACKUP_DIR:/backup" \
  api tar czf "/backup/storage-$STAMP.tar.gz" -C /data storage

# Шифруем, если задан ключ. Без ключа дампы лежат открытыми — это плохая идея
# на арендованном сервере, поэтому BACKUP_PASSPHRASE стоит задать.
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "[$(date -Is)] Шифрование…"
  for file in "$BACKUP_DIR/db-$STAMP.sql.gz" "$BACKUP_DIR/storage-$STAMP.tar.gz"; do
    gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 "$file"
    rm -f "$file"
  done
fi

echo "[$(date -Is)] Удаление копий старше $KEEP_DAYS дней…"
find "$BACKUP_DIR" -type f -name 'db-*' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'storage-*' -mtime "+$KEEP_DAYS" -delete

echo "[$(date -Is)] Готово. Текущие копии:"
ls -lh "$BACKUP_DIR" | tail -n 10
