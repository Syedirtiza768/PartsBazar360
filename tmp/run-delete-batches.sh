#!/bin/bash
# Delete zero-offer stale parts in autocommit batches of 5000.
set -eu
docker cp /tmp/delete-batch.sql partsbazar360-postgres-1:/tmp/delete-batch.sql
i=0
while true; do
  i=$((i+1))
  REMAINING=$(docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -A -f /tmp/delete-batch.sql | tail -1)
  echo "batch $i: remaining=$REMAINING"
  if [ "$REMAINING" = "0" ] || [ -z "$REMAINING" ]; then break; fi
done
echo "DONE"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "DROP TABLE IF EXISTS tmp_stale_part_ids; SELECT COUNT(*) AS total_parts FROM \"CanonicalPart\";"
