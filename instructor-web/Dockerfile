FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# next.config.ts's rewrites() is resolved once, at `next build`, and baked
# into the production output — an env var set later at `docker run`/compose
# time has no effect on it. This has to be a build arg, not a runtime env
# var, or every request silently proxies to the wrong host.
ARG INSTRUCTOR_API_URL=http://localhost:8020
ENV INSTRUCTOR_API_URL=$INSTRUCTOR_API_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "start"]
