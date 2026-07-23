#!/bin/sh
set -e

# Workers never mutate schema — only the API (or a one-off migrate job) does.
echo "[worker-entrypoint] Starting ingestion worker (no schema migrate)..."
exec node dist/src/worker.js
