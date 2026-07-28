#!/bin/bash
sed -i 's/\r$//' /tmp/verify-wipe.sql
docker cp /tmp/verify-wipe.sql partsbazar360-postgres-1:/tmp/verify-wipe.sql
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/verify-wipe.sql
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
ps aux | grep -E 'run-wipe-indexed|CanonicalPart' | grep -v grep || echo no_wipe_proc
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/pg-activity.sql | head -n 15
# ensure API up
docker start partsbazar360-api-1 >/dev/null 2>&1 || true
