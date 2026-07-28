#!/bin/bash
set -eu
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'partsbazar_db'
  AND pid <> pg_backend_pid()
  AND query NOT ILIKE '%DELETE FROM "SellerOffer"%';
SQL
echo killed_others
sleep 90
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/pg-activity.sql
echo ---
tail -n 40 /tmp/wipe-dropfk.log
