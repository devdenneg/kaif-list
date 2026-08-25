#!/usr/bin/env bash
# SSH-туннель к продакшен-базе и Redis.
#
# Postgres и Redis на сервере слушают только петлевой интерфейс — снаружи
# они закрыты. Этот скрипт пробрасывает их на локальные порты, чтобы можно
# было запускать бэкенд локально против боевых данных.
#
#   ./scripts/prod-tunnel.sh          # держать открытым в отдельном терминале
#
# После запуска доступны:
#   PostgreSQL → 127.0.0.1:5433
#   Redis      → 127.0.0.1:6380
#
# ВНИМАНИЕ: это боевая база. Миграции и удаление данных отсюда — необратимы.

set -euo pipefail

VPS_HOST="${VPS_HOST:-45.130.127.31}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/kaif_deploy}"

if [ ! -f "$SSH_KEY" ]; then
  echo "✗ Не найден ключ $SSH_KEY" >&2
  echo "  Положите приватный деплой-ключ туда или задайте SSH_KEY=/путь/к/ключу" >&2
  exit 1
fi

echo "▸ Туннель к $VPS_USER@$VPS_HOST"
echo "  PostgreSQL → 127.0.0.1:5433"
echo "  Redis      → 127.0.0.1:6380"
echo "  Ctrl+C — закрыть"
echo

exec ssh -N \
  -i "$SSH_KEY" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -L 5433:127.0.0.1:5432 \
  -L 6380:127.0.0.1:6379 \
  "$VPS_USER@$VPS_HOST"
