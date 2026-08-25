#!/usr/bin/env bash
# Первичная настройка чистого VPS (Ubuntu 22.04/24.04) под Kaif Board.
# Запускать от root: bash deploy/setup-server.sh
#
# Скрипт намеренно ничего не делает молча: каждый шаг печатает, что происходит.

set -euo pipefail

log() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Запустите от root: sudo bash $0" >&2
  exit 1
fi

APP_USER="${APP_USER:-kaif}"
APP_DIR="${APP_DIR:-/opt/kaif-board}"

log "Обновляем систему"
apt-get update && apt-get upgrade -y

log "Ставим базовые пакеты"
apt-get install -y ca-certificates curl git gnupg ufw fail2ban unattended-upgrades

log "Ставим Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

log "Создаём сервисного пользователя $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi
usermod -aG docker "$APP_USER"

log "Настраиваем файрвол"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "Включаем автоматические обновления безопасности"
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Ужесточаем SSH (только ключи)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

log "Готовим каталог приложения"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat <<NEXT

Готово. Дальше:

  1. su - $APP_USER
  2. git clone <репозиторий> $APP_DIR && cd $APP_DIR
  3. cp .env.example .env && chmod 600 .env && nano .env
  4. docker compose -f docker-compose.prod.yml up -d --build
  5. Проверьте:  curl -I https://<ваш-домен>/healthz

Не забудьте направить A-запись домена на этот сервер до первого запуска —
Caddy получит сертификат автоматически.

NEXT
