FROM node:22-bookworm-slim AS base

WORKDIR /app

# Prisma's query engine needs OpenSSL at generate time and at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM base AS builder

WORKDIR /app
COPY . ./

RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Sync the database schema (additive changes only; fails instead of dropping data).
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
