# syntax=docker/dockerfile:1.7
# Многоступенчатая сборка монорепозитория.
# Цели: api, bot, web.
#
# Зависимости для рантайма ставятся отдельно для каждого приложения.
# Иначе в образ API попадают React, TipTap и Recharts, а в образ бота —
# Prisma с движками: на сервере с диском в 10 ГБ это разница в гигабайты.

# ─────────────────────────────── Основа ─────────────────────────────────────
FROM node:22-bookworm-slim AS base
WORKDIR /app

# openssl нужен Prisma, чтобы правильно определить целевую платформу движка.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Копируем только манифесты — слой с зависимостями кешируется,
# пока не изменится package.json или package-lock.json.
COPY package.json package-lock.json* .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

# ───────────────────── Зависимости для сборки ───────────────────────────────
FROM base AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ─────────────────────────────── Сборка ─────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

# Идентификатор сборки версионирует кеш сервис-воркера: без него
# после выкатки в браузере остались бы файлы предыдущей версии.
ARG VITE_BUILD_ID="dev"
ENV VITE_BUILD_ID=${VITE_BUILD_ID}

RUN npm run build -w @kaif/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @kaif/api \
 && npm run build -w @kaif/bot \
 && npx vite build --config apps/web/vite.config.ts

# ──────────────── Продакшен-зависимости: API ────────────────────────────────
FROM base AS prod-deps-api
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev -w @kaif/api -w @kaif/shared --include-workspace-root

# Клиент Prisma генерируется ПОСЛЕ установки: npm считает каталог .prisma
# лишним и удаляет его при любой последующей чистке зависимостей.
COPY apps/api/prisma ./apps/api/prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# ──────────────── Продакшен-зависимости: бот ────────────────────────────────
FROM base AS prod-deps-bot
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev -w @kaif/bot -w @kaif/shared --include-workspace-root

# ──────────────────────────────── API ───────────────────────────────────────
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps-api /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY package.json ./

# Приложение работает под непривилегированным пользователем.
#
# `chown -R` по /app здесь был бы очень дорогой ошибкой: смена владельца
# переписывает каждый файл, и слой с node_modules дублируется целиком —
# в нашем случае это 362 МБ пустого веса. Приложению право записи в /app
# и не нужно: оно только читает код, а пишет в /data/storage.
RUN mkdir -p /data/storage && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]

# ──────────────────────────────── Бот ───────────────────────────────────────
FROM node:22-bookworm-slim AS bot
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps-bot /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder /app/apps/bot/package.json ./apps/bot/
COPY package.json ./

USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOT_PORT||4100)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(process.env.BOT_MODE==='webhook'?1:0))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/bot/dist/index.js"]

# ───────────────────────── Веб + TLS-прокси ─────────────────────────────────
FROM caddy:2-alpine AS web
COPY --from=builder /app/apps/web/dist /srv/www
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
