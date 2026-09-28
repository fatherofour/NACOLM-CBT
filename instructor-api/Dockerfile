FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma7.config.ts ./prisma7.config.ts
COPY scripts ./scripts

EXPOSE 8020
# Prisma 7's driver-adapter client needs no native query-engine binary, so
# this stays a plain JS runtime image — migrate deploy is non-interactive
# and safe to run on every start (a no-op once the schema is current).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
