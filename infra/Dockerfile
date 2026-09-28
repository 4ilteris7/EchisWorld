# syntax=docker/dockerfile:1
#
# ECHIS production image (F8A).
#
# One dependency install + one build feed three runtime targets:
#   --target web      → Next.js standalone server (port 3000)
#   --target worker   → collector worker (esbuild bundle, no node_modules)
#   --target migrate  → one-shot SQL migration runner
#
# Secrets are NEVER baked in: .env* is excluded by .dockerignore and every
# credential arrives at runtime through the compose env file (§10.1).

# ── shared dependency layer ─────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── web build ───────────────────────────────────────────────────────────────
# Keep the production Next.js build isolated from the collector build. Local
# development needs a fresh worker bundle, but must not pay for `next build`.
FROM node:24-slim AS web-build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── worker build ────────────────────────────────────────────────────────────
# esbuild produces a self-contained collector bundle in seconds and no longer
# invalidates or waits for the much heavier Next.js production build.
FROM node:24-slim AS worker-build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run worker:build

# ── web ─────────────────────────────────────────────────────────────────────
# Next.js standalone output ships its own minimal server.js and only the
# node_modules it actually traced — public/ and .next/static are NOT included
# by Next, so they are copied explicitly.
FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --system --uid 10001 --create-home echis
COPY --from=web-build --chown=echis:echis /app/.next/standalone ./
COPY --from=web-build --chown=echis:echis /app/.next/static ./.next/static
COPY --from=web-build --chown=echis:echis /app/public ./public
USER echis
EXPOSE 3000
CMD ["node", "server.js"]

# ── worker ──────────────────────────────────────────────────────────────────
# The esbuild bundle is self-contained (pg included, pg-native external and
# unused). No node_modules are needed at runtime.
FROM node:24-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 10002 --create-home echisw
COPY --from=worker-build --chown=echisw:echisw /app/dist/worker ./dist/worker
USER echisw
# SIGTERM reaches node directly (exec form) so graceful shutdown runs:
# final heartbeat, released advisory lock, closed pool.
CMD ["node", "dist/worker/index.cjs"]

# ── migrate ─────────────────────────────────────────────────────────────────
# Runs once per deploy, before web and worker start. Needs the owner role
# because DDL is owner-only (§10.2).
FROM node:24-slim AS migrate
WORKDIR /app
ENV NODE_ENV=production
# Only the driver is needed; a fresh minimal install keeps this image small
# and independent of how the app's dependency tree happens to be hoisted.
RUN printf '{"name":"echis-migrate","private":true}\n' > package.json \
    && npm install --omit=dev pg \
    && npm cache clean --force
COPY scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY db/migrations ./db/migrations
CMD ["node", "scripts/db-migrate.mjs"]
