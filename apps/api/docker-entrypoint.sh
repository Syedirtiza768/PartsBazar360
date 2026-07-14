#!/bin/sh
set -e

echo "[entrypoint] Syncing database schema with Prisma..."
npx prisma db push --accept-data-loss

echo "[entrypoint] Starting API server..."
exec node dist/src/main.js
