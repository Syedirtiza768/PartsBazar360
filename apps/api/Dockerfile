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
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma ./prisma
EXPOSE 3001
CMD ["node", "dist/main.js"]
