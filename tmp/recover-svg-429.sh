#!/bin/bash
# Recover from RealTrack 429: pause wasteful drain, slow worker, requeue deferred.
set -euo pipefail
cd /home/ubuntu/PartsBazar360
ENVF=/home/ubuntu/PartsBazar360/.env

echo "=== stop worker to halt 429 burn ==="
sudo docker compose stop worker

echo "=== snapshot queue + deferred counts ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT "enrichmentStatus", COUNT(*) AS n
FROM "CanonicalPart" cp
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" so
  WHERE so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
)
AND COALESCE((
  SELECT MAX(so.price) FROM "SellerOffer" so
  WHERE so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
),0) >= 300
GROUP BY 1
ORDER BY n DESC;
SQL

WAIT=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized | tr -d '\r')
echo "prioritized_before=$WAIT"

echo "=== drain prioritized/wait (jobs will be re-enqueued throttled) ==="
# Move remaining job ids aside by pausing isn't available easily; empty lists carefully.
# BullMQ prioritized is a zset; waiting is a list.
sudo docker compose exec -T redis redis-cli DEL bull:enrichment:wait bull:enrichment:paused || true
# Do NOT delete prioritized blindly with DEL if meta needed — use ZREMRANGEBYRANK
sudo docker compose exec -T redis redis-cli ZREMRANGEBYRANK bull:enrichment:prioritized 0 -1
sudo docker compose exec -T redis redis-cli DEL bull:enrichment:active || true

# Reset QUEUED/RUNNING that no longer have jobs back to NULL-ish for requeue
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
UPDATE "CanonicalPart" cp
SET "enrichmentStatus" = 'DEFERRED'
WHERE "enrichmentStatus" IN ('QUEUED', 'RUNNING')
  AND "infographicSpec" IS NULL
  AND EXISTS (
    SELECT 1 FROM "SellerOffer" so
    WHERE so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
  )
  AND COALESCE((
    SELECT MAX(so.price) FROM "SellerOffer" so
    WHERE so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
  ),0) >= 300;
SQL

echo "=== set concurrency=1 ==="
if grep -q '^ENRICHMENT_CONCURRENCY=' "$ENVF"; then
  sed -i 's/^ENRICHMENT_CONCURRENCY=.*/ENRICHMENT_CONCURRENCY=1/' "$ENVF"
else
  echo 'ENRICHMENT_CONCURRENCY=1' >> "$ENVF"
fi
grep ENRICHMENT_CONCURRENCY "$ENVF"

echo "=== restart worker ==="
sudo docker compose up -d worker
sleep 6
sudo docker compose exec -T worker sh -c 'echo CONC=$ENRICHMENT_CONCURRENCY DIAG=$LOCATION_DIAGRAM_MIN_PRICE_USD'
