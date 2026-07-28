#!/bin/bash
set -eu
pkill -f run-wipe-batches || true
docker stop partsbazar360-api-1 >/dev/null 2>&1 || true
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d postgres -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid<>pg_backend_pid();" || true
sleep 2
sed -i 's/\r$//' /tmp/explain-delete.sql
docker cp /tmp/explain-delete.sql partsbazar360-postgres-1:/tmp/explain-delete.sql
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/explain-delete.sql
