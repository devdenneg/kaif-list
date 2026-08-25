# Перенос на другой сервер и в другой git

Инструкция для того, кто будет переносить Kaif Board на новый VPS и в GitLab.
Написана после того, как всё это один раз уже собрали с нуля, — здесь и порядок
действий, и грабли, на которые уже наступили.

Базу данных переносить не планируется: начинаем с пустой. Поэтому основное
внимание — **секретам, доступам и пайплайну**, чтобы после переезда всё
работало ровно так же.

Общее описание того, как устроена выкатка, лежит в [DEPLOYMENT.md](DEPLOYMENT.md).
Здесь — только то, что нужно именно при переносе.

---

## 1. Что живёт вне репозитория

Это главный список. Всё перечисленное **не хранится в git** и потеряется, если
не перенести руками.

| Что | Где сейчас | Что с этим делать |
|---|---|---|
| Секреты пайплайна | GitHub → Settings → Secrets → Actions | Завести заново в GitLab (раздел 4) |
| `.env` приложения | `/opt/kaif-board/.env` на VPS, 39 переменных | Скопировать содержимое, часть значений сгенерировать заново (раздел 5) |
| Приватный SSH-ключ выкатки | секрет `VPS_SSH_KEY` + локально `~/.ssh/kaif_deploy` | Сгенерировать **новую** пару для нового сервера |
| Публичный SSH-ключ | `/home/deploy/.ssh/authorized_keys` на VPS | Положить новый публичный ключ на новый сервер |
| Токен Telegram-бота | `.env`, `TELEGRAM_BOT_TOKEN` | Перенести как есть **или** отозвать и выпустить новый (см. раздел 7) |
| Образы контейнеров | GHCR, `ghcr.io/devdenneg/kaif-list-{api,bot,web}` | Пересобрать в реестре GitLab, старые не нужны |
| TLS-сертификат | том `kaif-board_caddy-data` | Не переносить: Caddy выпустит новый сам |
| Файлы вложений | том `kaif-board_storage-data` | Переносить, только если нужны старые вложения |
| Домен | `45.130.127.31.sslip.io` — производная от IP | Меняется автоматически вместе с IP (раздел 6) |

### Как снять текущие значения

```bash
# Имена переменных без значений — чтобы понять состав
ssh deploy@45.130.127.31 'sed -E "s/=.*//" /opt/kaif-board/.env'

# Полное содержимое — обращаться как с паролями, не класть в git и не слать в чат
ssh deploy@45.130.127.31 'cat /opt/kaif-board/.env' > /tmp/kaif.env
```

---

## 2. Что сейчас на сервере

Чтобы новый выглядел так же:

- Ubuntu 24.04 LTS, 1 vCPU, **961 МБ памяти**, диск 9.8 ГБ (занято ~6 ГБ)
- Docker 29.x + Compose v2 (плагин, команда `docker compose`)
- Пользователь `deploy` (uid 1000) в группе `docker`, вход только по ключу
- `ufw`: открыты 22/tcp, 80/tcp, 443/tcp, 443/udp (последний — HTTP/3)
- Каталог `/opt/kaif-board`, владелец `deploy`, внутри только два файла:
  `docker-compose.yml` и `.env` (~5 КБ вместе). **Исходников на сервере нет**
- Тома: `kaif-board_postgres-data`, `_redis-data`, `_storage-data`,
  `_caddy-data`, `_caddy-config`
- Пять контейнеров: `postgres`, `redis`, `api`, `bot`, `web`
  (в `web` — Caddy: он же отдаёт статику, проксирует API и получает TLS)

Память — самое узкое место. Лимиты уже выставлены в compose: api 400 МБ,
bot 150 МБ, плюс `NODE_OPTIONS=--max-old-space-size` внутри. Если новый сервер
такой же слабый, ничего не трогайте. Если мощнее — лимиты можно поднять,
но это не обязательно.

---

## 3. Порядок переноса

Рекомендуемая последовательность. Старый сервер выключаем **последним**, когда
новый уже проверен.

1. Поднять новый VPS и подготовить его (раздел «Подготовка сервера» в
   DEPLOYMENT.md: пользователь `deploy`, docker, ufw, `/opt/kaif-board`)
2. Создать проект в GitLab, добавить его как remote, запушить `main`
3. Сгенерировать новую пару SSH-ключей для выкатки, публичный положить
   на новый сервер
4. Завести переменные CI/CD в GitLab (раздел 4)
5. Написать `.gitlab-ci.yml` (раздел 4) и удалить `.github/workflows/`
6. Поправить захардкоженные адреса в репозитории (раздел 6)
7. Собрать `.env` на новом сервере (раздел 5)
8. Запустить пайплайн, дождаться выкатки
9. Переключить Telegram-бота на новый адрес (раздел 7)
10. Пройти чек-лист приёмки (раздел 9)
11. Погасить старый сервер

---

## 4. GitLab CI/CD

### Переменные проекта

Settings → CI/CD → Variables. Все — **Masked** (кроме `SSH_PRIVATE_KEY`,
её маскировать нельзя из-за переносов строк) и **Protected**, если выкатка
идёт только с защищённой ветки `main`.

| Переменная | Тип | Что внутри |
|---|---|---|
| `SSH_PRIVATE_KEY` | File | приватный ключ выкатки целиком, с `-----BEGIN…` и переводом строки в конце |
| `VPS_HOST` | Variable | IP или домен нового сервера |
| `VPS_USER` | Variable | `deploy` |
| `VPS_SSH_PORT` | Variable | `22`, если не меняли |
| `APP_DOMAIN` | Variable | домен для проверки здоровья, например `1.2.3.4.sslip.io` |

Соответствие старым секретам GitHub: `VPS_SSH_KEY` → `SSH_PRIVATE_KEY`,
`VPS_HOST`/`VPS_USER`/`VPS_SSH_PORT` — те же имена. `GITHUB_TOKEN` заменяется
встроенным `CI_JOB_TOKEN`, отдельно заводить нечего.

### Реестр образов: главное отличие от GitHub

В GHCR образы были **публичными**, и сервер тянул их без авторизации.
В GitLab реестр по умолчанию приватный, а `CI_JOB_TOKEN` живёт только внутри
джобы и на сервере не работает. Поэтому нужен **Deploy Token**:

Settings → Repository → Deploy tokens → создать с областью `read_registry`.
Полученные логин и пароль положить на сервер в `.env`:

```
REGISTRY_USER=gitlab+deploy-token-12345
REGISTRY_TOKEN=<пароль токена>
```

и научить `deploy/remote-deploy.sh` логиниться ими. Сейчас скрипт умеет
работать и без авторизации (это осознанно — образы были публичные), так что
достаточно передать переменные под теми же именами `GHCR_USER` / `GHCR_TOKEN`
либо переименовать их в скрипте на `REGISTRY_USER` / `REGISTRY_TOKEN`.

**Если этого не сделать, выкатка упадёт на `docker compose pull` с `denied`.**

### Набросок `.gitlab-ci.yml`

Прямой перевод текущего `.github/workflows/deploy.yml`. Три стадии, три образа
из одного `deploy/Dockerfile` разными целями.

```yaml
stages: [check, build, deploy]

variables:
  IMAGE_PREFIX: $CI_REGISTRY_IMAGE
  DOCKER_BUILDKIT: '1'

# ── Проверки: падаем до сборки, а не после ──
check:
  stage: check
  image: node:22
  cache:
    key: { files: [package-lock.json] }
    paths: [.npm]
  script:
    - npm ci --cache .npm --prefer-offline
    - npx prisma generate --schema apps/api/prisma/schema.prisma
    - npm run build -w @kaif/shared
    - npm run typecheck
    - npm test

# ── Сборка трёх образов ──
.build: &build
  stage: build
  image: docker:27
  services: [docker:27-dind]
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

build:api:
  <<: *build
  script:
    - docker build --target api -f deploy/Dockerfile
      -t "$IMAGE_PREFIX/api:$CI_COMMIT_SHA" -t "$IMAGE_PREFIX/api:latest" .
    - docker push "$IMAGE_PREFIX/api:$CI_COMMIT_SHA"
    - docker push "$IMAGE_PREFIX/api:latest"

build:bot:
  <<: *build
  script:
    - docker build --target bot -f deploy/Dockerfile
      -t "$IMAGE_PREFIX/bot:$CI_COMMIT_SHA" -t "$IMAGE_PREFIX/bot:latest" .
    - docker push "$IMAGE_PREFIX/bot:$CI_COMMIT_SHA"
    - docker push "$IMAGE_PREFIX/bot:latest"

build:web:
  <<: *build
  script:
    # VITE_BUILD_ID попадает в имя файла service worker — без него
    # у людей остаётся закешированная старая версия фронтенда.
    - docker build --target web -f deploy/Dockerfile
      --build-arg VITE_BUILD_ID="$CI_COMMIT_SHA"
      -t "$IMAGE_PREFIX/web:$CI_COMMIT_SHA" -t "$IMAGE_PREFIX/web:latest" .
    - docker push "$IMAGE_PREFIX/web:$CI_COMMIT_SHA"
    - docker push "$IMAGE_PREFIX/web:latest"

# ── Выкатка ──
deploy:
  stage: deploy
  image: alpine:3.20
  resource_group: production   # аналог concurrency в GitHub: две выкатки разом недопустимы
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  before_script:
    - apk add --no-cache openssh-client curl
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - cp "$SSH_PRIVATE_KEY" ~/.ssh/id && chmod 600 ~/.ssh/id
    # Фиксируем ключ хоста: без этого подключение уязвимо к подмене
    - ssh-keyscan -p "${VPS_SSH_PORT:-22}" -H "$VPS_HOST" >> ~/.ssh/known_hosts 2>/dev/null
  script:
    - scp -i ~/.ssh/id -P "${VPS_SSH_PORT:-22}"
        deploy/docker-compose.deploy.yml
        "$VPS_USER@$VPS_HOST:/opt/kaif-board/docker-compose.yml"
    - ssh -i ~/.ssh/id -p "${VPS_SSH_PORT:-22}" "$VPS_USER@$VPS_HOST"
        "IMAGE_API='$IMAGE_PREFIX/api:$CI_COMMIT_SHA'
         IMAGE_BOT='$IMAGE_PREFIX/bot:$CI_COMMIT_SHA'
         IMAGE_WEB='$IMAGE_PREFIX/web:$CI_COMMIT_SHA'
         GHCR_USER='$CI_REGISTRY_USER'
         GHCR_TOKEN='$CI_REGISTRY_PASSWORD'
         bash -s" < deploy/remote-deploy.sh
    # Ждём, пока сервис реально ответит
    - |
      for i in $(seq 1 30); do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$APP_DOMAIN/healthz" || echo 000)
        [ "$code" = "200" ] && echo "✓ Сервис отвечает" && exit 0
        echo "  попытка $i: код $code"; sleep 10
      done
      echo "✗ Сервис не ответил за 5 минут"; exit 1
```

Что важно не потерять при переводе:

- **`resource_group: production`** — замена `concurrency` из GitHub. Две
  одновременные выкатки на один сервер с 961 МБ памяти кончаются плохо.
- **`VITE_BUILD_ID`** — идёт в сборку веба и попадает в адрес service worker.
  Без него у людей в браузере остаётся старая версия фронтенда.
- **`ssh-keyscan`** перед подключением — иначе либо `StrictHostKeyChecking=no`
  (небезопасно), либо джоба зависает на вопросе.
- **Кеш сборки образов.** В GitHub использовался `type=gha`, в GitLab его нет.
  Либо смиритесь с более долгой сборкой, либо настройте
  `--cache-from type=registry,ref=$IMAGE_PREFIX/api:cache`.
- Файл `deploy/remote-deploy.sh` менять почти не нужно: он получает всё через
  переменные окружения и ничего не знает про GitHub.

### Второй пайплайн

`.github/workflows/ci.yml` (проверки на каждый пуш и PR) переносится как
джоба `check` с `rules` на все ветки и merge request'ы. Отдельного файла
не требуется.

---

## 5. Переменные `.env` на сервере

Файл `/opt/kaif-board/.env`, владелец `deploy`, права `600`. Ниже — полный
состав с пометками, что можно скопировать, а что нужно поменять.

### Обязательно поменять

| Переменная | Как получить |
|---|---|
| `DOMAIN` | новый домен, например `1.2.3.4.sslip.io` |
| `APP_URL` | `https://<DOMAIN>` |
| `API_URL` | `https://<DOMAIN>` — тот же домен, см. грабли ниже |
| `VITE_API_URL` | пустая строка (фронт ходит на свой же домен) |
| `CORS_ORIGINS` | `https://<DOMAIN>` |
| `BOT_WEBHOOK_URL` | `https://<DOMAIN>/telegram/<TELEGRAM_WEBHOOK_SECRET>` |
| `ACME_EMAIL` | почта для Let's Encrypt |

### Сгенерировать заново

```bash
openssl rand -base64 48   # JWT_SECRET (минимум 32 символа)
openssl rand -base64 36   # INTERNAL_API_SECRET (минимум 24)
openssl rand -hex 24      # TELEGRAM_WEBHOOK_SECRET (минимум 16)
openssl rand -base64 24   # POSTGRES_PASSWORD
```

Смена `JWT_SECRET` разлогинивает всех и обесценивает все выданные токены.
При переезде на чистую базу это неважно, но **после переезда значение должно
быть стабильным**: если оно будет меняться при каждой выкатке, людей будет
выбрасывать из аккаунта постоянно.

### Скопировать как есть

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `SUPERADMIN_TELEGRAM_IDS` —
если бота не меняете. `POSTGRES_USER`, `POSTGRES_DB` — произвольные, можно
оставить прежние.

### Оставить как есть

Эти значения подобраны под слабый сервер, менять без причины не нужно:

```
NODE_ENV=production
LOG_LEVEL=info
HOST=0.0.0.0
PORT=4000
BOT_MODE=webhook
BOT_SET_WEBHOOK=true
BOT_HOST=0.0.0.0
BOT_PORT=4100
TRUST_PROXY=true
ENABLE_WORKERS=true
ENABLE_REALTIME=true
STORAGE_DIR=/data/storage
MAX_UPLOAD_MB=25
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW=1 minute
AUTH_RATE_LIMIT_MAX=12
AUTH_RATE_LIMIT_WINDOW=15 minutes
COOKIE_DOMAIN=
```

`IMAGE_API`, `IMAGE_BOT`, `IMAGE_WEB` вписывать руками не нужно — их
проставляет `remote-deploy.sh` при каждой выкатке. Но **до первой выкатки**
их в файле нет, поэтому `docker compose` на сервере ругнётся; это нормально.

---

## 6. Захардкоженные адреса в репозитории

Найдены полным поиском, других нет:

| Файл | Что | Как менять |
|---|---|---|
| `.github/workflows/deploy.yml` | `ghcr.io`, `45.130.127.31.sslip.io` | файл удаляется целиком вместе с GitHub Actions |
| `deploy/remote-deploy.sh:20,68` | `docker login/logout ghcr.io` | заменить на `$CI_REGISTRY` или адрес реестра GitLab |
| `scripts/prod-tunnel.sh:18-20` | IP, пользователь, путь к ключу | значения по умолчанию, переопределяются переменными `VPS_HOST`, `VPS_USER`, `SSH_KEY` — но лучше поправить |
| `apps/web/vite.config.ts:9` | `https://45.130.127.31.sslip.io` как цель прокси | новый домен; переопределяется переменной `VITE_API_PROXY` |
| `docs/DEPLOYMENT.md` | адреса и примеры | обновить после переезда |

`deploy/docker-compose.deploy.yml`, `deploy/Dockerfile` и `deploy/Caddyfile`
править не нужно: они берут всё из переменных.

---

## 7. Telegram

Бот у продукта один, и **вебхук у бота тоже один**. Пока старый сервер жив
и у него `BOT_SET_WEBHOOK=true`, два сервера будут перетягивать вебхук друг
у друга, и сообщения будут теряться.

Варианты:

- **Простой.** Погасить бота на старом сервере (`docker compose stop bot`)
  перед первым запуском нового. Тогда новый пропишет вебхук на себя.
- **Аккуратный.** Завести через @BotFather второго бота для нового сервера,
  проверить всё на нём, и только потом переключить основного. Не забыть
  поменять `TELEGRAM_BOT_USERNAME` — он показывается на экране входа.

После переезда проверить, что вебхук указывает куда надо:

```bash
curl -s "https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo" | python3 -m json.tool
```

В ответе `url` должен совпадать с `BOT_WEBHOOK_URL`, а `last_error_message`
быть пустым.

**Токен бота стоит отозвать и выпустить заново**, если он засветился
в переписке или в логах. Делается в @BotFather, командой `/revoke`.

---

## 8. Грабли, на которые уже наступали

Всё перечисленное реально ломало выкатку или продукт. Экономит часы.

**Диск кончается во время выкатки.** На 10 ГБ старые и новые образы какое-то
время лежат рядом. `remote-deploy.sh` уже чистит образы **до** загрузки и
отказывается выкатываться, если свободно меньше 1.2 ГБ. Не убирайте эту
проверку. Если диск на новом сервере такой же маленький, посмотрите заодно,
не занимает ли лишнего сама Ubuntu (`linux-firmware`, старые ядра, snapd —
в прошлый раз освободили 1.1 ГБ).

**`npm prune` удаляет сгенерированный клиент Prisma.** В Dockerfile порядок
такой: сначала `npm prune --omit=dev`, потом `prisma generate`. Поменяете
местами — контейнер не стартует.

**Движок Prisma собирается под конкретный OpenSSL.** В `schema.prisma` стоит
`binaryTargets = ["native", "debian-openssl-3.0.x"]`. Если поменяете базовый
образ на другой дистрибутив, поправьте и это.

**`chown -R node:node /app` в Dockerfile удваивает размер образа.** Копия
всех `node_modules` уезжает в отдельный слой (было +800 МБ). Владельца
меняем только у `/data`.

**Фронт и API обязаны быть на одном домене.** Refresh-кука выставлена
с `SameSite=Strict`. Разнесёте их по поддоменам — вход перестанет работать
незаметным образом: логин пройдёт, а после перезагрузки страницы человека
выбросит. Caddy для того и проксирует `/api/*` на том же домене.

**`TRUST_PROXY=true` только за обратным прокси.** Иначе клиент сможет
подделать свой IP заголовком `X-Forwarded-For`, и в журнале безопасности
будет ложь.

**Первый вход после чистой базы.** Суперадмин выдаётся по
`SUPERADMIN_TELEGRAM_IDS` при первом входе. Забудете вписать свой Telegram id —
останетесь без админки, и чинить придётся руками в базе.

**BullMQ и двоеточия.** Идентификатор джобы может содержать `:`, только если
частей ровно три. Нарушение ломает доставку уведомлений тихо: в вебе всё
появляется, в Telegram — нет. Есть тест `apps/api/src/queue/job-id.test.ts`,
не удаляйте его.

**Проверка здоровья после выкатки обязательна.** Без неё пайплайн зеленеет,
даже когда контейнер падает в цикле рестартов.

**`docker compose ps` на сервере падает без тегов образов.** Поэтому
`remote-deploy.sh` пишет `IMAGE_*` в `.env`, а не только в окружение команды.

---

## 9. Чек-лист приёмки

После первой успешной выкатки пройти по пунктам. Половина проблем прошлого
раза находилась именно здесь.

- [ ] `https://<DOMAIN>/healthz` отвечает `200`, сертификат валидный
- [ ] Открывается экран входа, **виден код подтверждения** (не пустая рамка)
- [ ] Вход через Telegram проходит, код в боте совпадает с кодом на экране
- [ ] Первый вошедший получил роль суперадмина, админка открывается
- [ ] Создаётся доска, создаётся задача, карточка перетаскивается между колонками
- [ ] Перетаскивание видно во второй вкладке без перезагрузки (websocket жив)
- [ ] Файл прикладывается к задаче и открывается по ссылке
- [ ] Картинка вставляется в описание и переживает сохранение
- [ ] Уведомление доходит в Telegram (назначьте задачу на второго человека)
- [ ] Перезагрузка страницы не выбрасывает из аккаунта
- [ ] Через 20 минут простоя клик по интерфейсу не открывает экран входа
- [ ] `docker compose ps` — все пять сервисов `healthy`
- [ ] `free -h` — есть запас памяти под нагрузкой
- [ ] Повторный пуш в `main` выкатывается автоматически и проходит проверку здоровья

---

## 10. Локальная разработка после переезда

Сейчас локальная разработка идёт **против боевой базы и боевого API** через
SSH-туннель: `npm run dev:tunnel`. После переезда достаточно поменять
`VPS_HOST` в `scripts/prod-tunnel.sh` (или экспортировать переменную) и путь
к новому ключу в `SSH_KEY`.

Прокси фронтенда живёт в `apps/web/vite.config.ts` и переписывает `Origin`,
а также срезает у куки атрибуты `Secure` и `SameSite`, чтобы вход работал
на `http://localhost`. Эту логику не трогайте — без неё локально не залогиниться.

---

## 11. Что не забыть после переезда

- Обновить `docs/DEPLOYMENT.md`: адреса, имена секретов, реестр
- Обновить этот файл, если порядок действий на практике оказался другим
- Отозвать старые доступы: SSH-ключ выкатки на старом сервере, токен GHCR,
  секреты в GitHub-репозитории
- Погасить старый VPS только после того, как новый отработал сутки
- Сменить пароль root на новом сервере и отключить вход по паролю
  (`PasswordAuthentication no` в `/etc/ssh/sshd_config`)
