# Развёртывание

## Текущий продакшен

| | |
|---|---|
| Адрес | https://45.130.127.31.sslip.io |
| Сервер | 45.130.127.31, Ubuntu 24.04, 1 vCPU / 1 ГБ RAM / 10 ГБ SSD |
| Каталог | `/opt/kaif-board` |
| Пользователь | `deploy` (в группе `docker`) |
| Бот | [@kaif_board_bot](https://t.me/kaif_board_bot), режим webhook |
| Выкатка | автоматически при пуше в `main` |

Домена пока нет, поэтому используется `sslip.io` — это настоящее DNS-имя,
которое резолвится в IP сервера, и Let's Encrypt выдаёт для него обычный
сертификат. Когда появится свой домен, достаточно направить на него A-запись
и поменять три строки в `/opt/kaif-board/.env` (`DOMAIN`, `APP_URL`, `API_URL`,
`BOT_WEBHOOK_URL`), затем перезапустить стек.

### Автоматическая выкатка

Пуш в `main` запускает `.github/workflows/deploy.yml`:

1. **Проверки** — типы и тесты. Падают здесь — дальше ничего не происходит.
2. **Сборка** — три образа (`api`, `bot`, `web`) собираются на раннере GitHub
   и уходят в GHCR. На самом VPS сборка невозможна: 1 ГБ памяти не хватит
   даже на сборку фронтенда.
3. **Выкатка** — по SSH выполняется `deploy/remote-deploy.sh`: вход в реестр,
   `docker compose pull`, перезапуск, уборка старых образов.
4. **Проверка живости** — воркфлоу ждёт `200 OK` от `/healthz` и падает,
   если сервис не поднялся за пять минут.

Секреты приложения (токен бота, пароль базы, ключи подписи) живут **только
на сервере** в `/opt/kaif-board/.env` и в GitHub не попадают. В секретах
GitHub лежит только доступ по SSH.

### Секреты GitHub

| Секрет | Значение |
|---|---|
| `VPS_HOST` | `45.130.127.31` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | приватный деплой-ключ целиком, вместе со строками `BEGIN`/`END` |
| `VPS_SSH_PORT` | необязательно, по умолчанию `22` |

### Что лежит на сервере

Только два файла — исходников там нет, код живёт в GitHub и внутри образов:

```
/opt/kaif-board/
├── docker-compose.yml   обновляется при каждой выкатке
└── .env                 секреты, создаётся один раз вручную
```

Данные — в томах Docker: `postgres-data`, `redis-data`, `storage-data`,
`caddy-data`. Они переживают любую выкатку и пересоздание контейнеров.

### Ограничения этого сервера

1 vCPU, 961 МБ RAM, 10 ГБ диска — запаса нет, поэтому:

- **образы собираются в CI, а не на сервере**: сборка фронтенда не помещается
  в память;
- **лимиты памяти** прописаны в compose-файле: без них один разросшийся
  процесс утаскивает за собой всю машину, включая базу;
- **своп увеличен до 2.5 ГБ** — страховка от OOM, не замена памяти;
- **выкатка освобождает место до загрузки образов** и останавливается,
  если свободного меньше 1.2 ГБ;
- из системы убраны прошивки железа, snapd и лишнее ядро — на виртуальной
  машине они бесполезны, а занимали больше гигабайта.

Текущий расклад: система 1.9 ГБ, образы 1.3 ГБ, свободно 3.2 ГБ.

### Ручные операции на сервере

```bash
ssh -i ~/.ssh/kaif_deploy deploy@45.130.127.31
cd /opt/kaif-board

docker compose ps                  # состояние
docker compose logs -f api         # логи
docker compose restart api         # перезапуск одного сервиса
cat .current-images                # какие версии сейчас развёрнуты
```

**Откат** на предыдущую версию: в GitHub Actions открыть успешный запуск
нужного коммита и нажать «Re-run all jobs» — образы под тем SHA уже в реестре.

### Локальная разработка против боевых данных

Postgres и Redis на сервере слушают только петлевой интерфейс — снаружи
закрыты. Доступ к ним идёт через SSH-туннель:

```bash
npm run dev:tunnel     # держать в отдельном терминале
```

После этого доступны `127.0.0.1:5433` (Postgres) и `127.0.0.1:6380` (Redis).
Строку подключения возьмите из `.env.local.example`.

Фронтенд по умолчанию работает против **боевого API** — просто:

```bash
npm run dev:web        # http://localhost:5173 → боевой бэкенд
npm run dev:web:local  # если нужен локально запущенный API
```

Дев-сервер подставляет боевой `Origin` и снимает флаг `Secure` с cookie:
без этого браузер не сохранил бы refresh-токен на `http://localhost`,
и вход разваливался бы при первом обновлении токена.

> Это боевая база. `npm run db:migrate` и удаления отсюда необратимы.
> Для экспериментов поднимайте локальную: `npm run infra:up`.

---

## Установка с нуля на другой сервер

Минимальная конфигурация: **2 vCPU, 4 ГБ RAM, 40 ГБ SSD**
(текущий сервер меньше — он работает, но без запаса).

---

## 1. Перед началом

- Домен, A-запись которого уже указывает на IP сервера
  (Caddy получает сертификат при первом запуске — без работающего DNS не получится).
- Бот, созданный у [@BotFather](https://t.me/BotFather): нужны токен и username.
- Ваш Telegram ID (узнать: [@userinfobot](https://t.me/userinfobot)) — станете суперадмином.

---

## 2. Подготовка сервера

```bash
ssh root@<ip>
git clone <репозиторий> /tmp/kaif && cd /tmp/kaif
bash deploy/setup-server.sh
```

Скрипт ставит Docker, создаёт пользователя `kaif`, включает `ufw`
(открыты только 22, 80, 443), запрещает вход по паролю и включает
автоматические обновления безопасности.

---

## 3. Конфигурация

```bash
su - kaif
git clone <репозиторий> /opt/kaif-board && cd /opt/kaif-board
cp .env.example .env && chmod 600 .env
nano .env
```

Обязательно заполнить:

```dotenv
DOMAIN=board.example.com
APP_URL=https://board.example.com
API_URL=https://board.example.com
ACME_EMAIL=admin@example.com

POSTGRES_PASSWORD=<длинный пароль>
DATABASE_URL=postgresql://kaif:<тот же пароль>@postgres:5432/kaif_board?schema=public&connection_limit=20

JWT_SECRET=<openssl rand -base64 48>
INTERNAL_API_SECRET=<openssl rand -base64 32>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 16>

TELEGRAM_BOT_TOKEN=<токен>
TELEGRAM_BOT_USERNAME=<имя_без_@>
SUPERADMIN_TELEGRAM_IDS=<ваш id>

BOT_MODE=webhook
BOT_WEBHOOK_URL=https://board.example.com
TRUST_PROXY=true
```

> Пароль в `POSTGRES_PASSWORD` и внутри `DATABASE_URL` должен совпадать.
> Если в пароле есть спецсимволы — закодируйте их в URL (`@` → `%40`).

---

## 4. Запуск

Если образы уже собираются в CI — используйте `deploy/docker-compose.deploy.yml`
и подставьте теги образов. Для сборки прямо на сервере (нужно не меньше 2 ГБ памяти):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Что происходит:
1. Собираются образы (первый раз 3–6 минут).
2. Поднимаются Postgres и Redis, дожидаются healthcheck.
3. API применяет миграции (`prisma migrate deploy`) и стартует
   вместе с реалтаймом и фоновыми воркерами.
4. Бот регистрирует вебхук.
5. Caddy получает сертификат Let's Encrypt и начинает отдавать фронтенд.

Проверка:

```bash
curl -I https://<домен>/healthz              # 200
docker compose -f docker-compose.prod.yml ps # все healthy
docker compose -f docker-compose.prod.yml logs -f api
```

Откройте `https://<домен>`, войдите через Telegram, заполните имя и аватар.
Ваша учётная запись получит роль суперадмина автоматически.

Автозапуск после перезагрузки сервера:

```bash
sudo cp deploy/kaif-board.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now kaif-board
```

---

## 5. Обновление

```bash
cd /opt/kaif-board
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Миграции применяются автоматически при старте API. Простой — несколько секунд.

Откат:

```bash
git checkout <предыдущий-тег>
docker compose -f docker-compose.prod.yml up -d --build
```

> Откат кода не откатывает миграции базы. Если миграция была разрушительной,
> восстанавливайтесь из резервной копии.

---

## 6. Резервные копии

```bash
# Разовый запуск
bash deploy/backup.sh

# Ежедневно в 03:17
crontab -e
17 3 * * * /opt/kaif-board/deploy/backup.sh >> /var/log/kaif-backup.log 2>&1
```

Задайте `BACKUP_PASSPHRASE` в `.env` — тогда дампы шифруются AES-256.
Хранятся 14 дней (`BACKUP_KEEP_DAYS`).

**Восстановление базы:**

```bash
gunzip -c backups/db-2026-03-10_0317.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**Восстановление файлов:**

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -v "$PWD/backups:/backup" api \
  tar xzf /backup/storage-2026-03-10_0317.tar.gz -C /data
```

Проверяйте восстановление хотя бы раз в квартал. Непроверенная резервная
копия — это не резервная копия.

---

## 7. Эксплуатация

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f bot

# Перезапуск одного сервиса
docker compose -f docker-compose.prod.yml restart api

# Консоль базы
docker compose -f docker-compose.prod.yml exec postgres psql -U kaif -d kaif_board

# Место на диске (вложения растут быстрее всего)
docker system df
du -sh /var/lib/docker/volumes/*storage-data*
```

Состояние очереди уведомлений видно в веб-интерфейсе:
**Администрирование → Обзор**, а также в `/api/admin/queues`.

---

## 8. Диагностика

**Не выпускается сертификат.**
Проверьте, что A-запись домена указывает на сервер и порты 80/443 открыты:
`dig +short <домен>`, `ufw status`. Логи: `docker compose logs web`.

**Бот не отвечает.**
```bash
curl "https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo"
```
Смотрите `last_error_message`. Частые причины: `BOT_WEBHOOK_URL` без `https://`,
несовпадение `TELEGRAM_WEBHOOK_SECRET` между ботом и Caddy, бот ещё не поднялся.

**Уведомления не приходят.**
1. Пользователь запускал бота? В профиле должно быть «Бот подключён».
2. Не выключил ли он уведомления (`/settings` в боте)?
3. Не идут ли тихие часы?
4. Очередь: **Администрирование → Обзор**, поле `failed`.

**API не стартует.**
Почти всегда — конфигурация: сервер валидирует `.env` при старте и печатает,
какое поле не так. Смотрите первые строки `docker compose logs api`.

**Ошибка миграции.**
```bash
docker compose -f docker-compose.prod.yml exec api \
  npx prisma migrate status --schema apps/api/prisma/schema.prisma
```

---

## 9. Масштабирование

Порядок действий по мере роста:

1. **Вынести воркеры**: `ENABLE_WORKERS=false` у API, поднять отдельный
   контейнер с той же командой и `ENABLE_WORKERS=true`, `ENABLE_REALTIME=false`.
2. **Несколько инстансов API**: Socket.IO уже работает через Redis-адаптер,
   события ходят через Redis pub/sub — достаточно поднять реплики и
   добавить их в `reverse_proxy` Caddy.
3. **Отдельный сервер базы**: поменять `DATABASE_URL`, поднять `connection_limit`.
4. **S3 вместо диска**: заменить `lib/files.ts` — остальной код не изменится.
5. **Полнотекстовый поиск**: заменить `ILIKE` на `tsvector` в `buildTaskWhere`.
