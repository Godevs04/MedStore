# syntax=docker/dockerfile:1
# MediCore monorepo image. Targets: api, web.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @medicore/shared-types --filter @medicore/validation run build \
 && pnpm --filter @medicore/api exec prisma generate \
 && pnpm --filter @medicore/api run build

# ---- API ----
FROM build AS api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @medicore/api db:migrate && pnpm --filter @medicore/api db:seed && exec node apps/api/dist/main.js"]

# ---- Web (API URL is baked in at build time) ----
FROM build AS web-build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @medicore/web run build

FROM web-build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@medicore/web", "run", "start"]
