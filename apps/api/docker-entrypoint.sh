#!/bin/sh
set -e

# Prefer Prisma migrations over db push. Escape hatches:
#   SKIP_DB_MIGRATE=1     — skip entirely (replicas, workers, read-only boots)
#   SCHEMA_MODE=push      — legacy db push (bootstrap / drift recovery only)
#   SCHEMA_MODE=skip      — same as SKIP_DB_MIGRATE=1
# Never use --accept-data-loss in production entrypoints.
SCHEMA_MODE="${SCHEMA_MODE:-migrate}"

if [ "${SKIP_DB_MIGRATE:-0}" = "1" ] || [ "$SCHEMA_MODE" = "skip" ]; then
  echo "[entrypoint] Skipping database schema sync"
elif [ "$SCHEMA_MODE" = "push" ]; then
  echo "[entrypoint] SCHEMA_MODE=push — running prisma db push (no data-loss flag)..."
  npx prisma db push
elif [ "$SCHEMA_MODE" = "migrate" ]; then
  echo "[entrypoint] Applying Prisma migrations (migrate deploy)..."
  npx prisma migrate deploy
else
  echo "[entrypoint] Unknown SCHEMA_MODE=$SCHEMA_MODE — skipping schema sync"
fi

echo "[entrypoint] Starting API server (RUN_INGESTION_WORKER=${RUN_INGESTION_WORKER:-1})..."
exec node dist/src/main.js
