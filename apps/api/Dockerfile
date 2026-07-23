FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/
RUN npm ci --workspace=api

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm run build --workspace=@repo/catalog-contracts
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/catalog-contracts ./packages/catalog-contracts
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma.config.ts ./
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/scripts ./scripts
COPY --from=builder /app/apps/api/docker-entrypoint.sh ./
COPY --from=builder /app/apps/api/docker-entrypoint-worker.sh ./
RUN sed -i 's/\r$//' ./docker-entrypoint.sh ./docker-entrypoint-worker.sh \
  && chmod +x ./docker-entrypoint.sh ./docker-entrypoint-worker.sh \
  && mkdir -p node_modules/@repo \
  && rm -rf node_modules/@repo/catalog-contracts \
  && ln -s /app/packages/catalog-contracts node_modules/@repo/catalog-contracts
EXPOSE 3001
CMD ["./docker-entrypoint.sh"]
