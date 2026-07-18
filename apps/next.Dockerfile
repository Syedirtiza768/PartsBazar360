FROM node:20-alpine AS base
WORKDIR /app

ARG APP_NAME

FROM base AS deps
ARG APP_NAME
COPY package.json package-lock.json ./
COPY apps/${APP_NAME}/package.json ./apps/${APP_NAME}/
COPY packages/ui/package.json ./packages/ui/
COPY packages/catalog-contracts/package.json ./packages/catalog-contracts/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN npm ci

FROM base AS builder
ARG APP_NAME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=${APP_NAME}

FROM base AS runner
ARG APP_NAME
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_NAME=${APP_NAME}
WORKDIR /app
COPY --from=builder /app/apps/${APP_NAME}/.next/standalone ./
COPY --from=builder /app/apps/${APP_NAME}/.next/static ./apps/${APP_NAME}/.next/static
COPY --from=builder /app/apps/${APP_NAME}/public ./apps/${APP_NAME}/public
EXPOSE 3000
CMD ["sh", "-c", "node apps/${APP_NAME}/server.js"]
