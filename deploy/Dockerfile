# syntax=docker/dockerfile:1.7
# Многоступенчатая сборка монорепозитория.
# Цели: api, bot, web — каждая собирается отдельно, но зависимости ставятся один раз.

# ───────────────────────────── Зависимости ──────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Копируем только манифесты — слой с зависимостями кешируется,
# пока не изменится package.json или package-lock.json.
# openssl нужен Prisma, чтобы правильно определить целевую платформу движка.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

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

RUN npm run build -w @kaif/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @kaif/api \
 && npm run build -w @kaif/bot \
 && npx vite build --config apps/web/vite.config.ts

# ──────────────────────── Продакшен-зависимости ─────────────────────────────
FROM deps AS prod-deps
WORKDIR /app
COPY apps/api/prisma ./apps/api/prisma
# Порядок важен: npm prune считает сгенерированный каталог .prisma лишним
# и удаляет его, поэтому сначала чистим зависимости, а генерируем после.
RUN npm prune --omit=dev \
 && npx prisma generate --schema apps/api/prisma/schema.prisma

# ──────────────────────────────── API ───────────────────────────────────────
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production

# Файловые операции и sharp требуют системных библиотек изображений.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY package.json ./

# Приложение работает под непривилегированным пользователем.
RUN mkdir -p /data/storage && chown -R node:node /data /app
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

COPY --from=prod-deps /app/node_modules ./node_modules
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
