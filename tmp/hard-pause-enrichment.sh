#!/bin/bash
# Hard pause: stop worker + empty enrichment queue so 429 retries don't refresh the Nest block.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== stop worker ==="
sudo docker compose stop worker

echo "=== empty enrichment queue keys ==="
sudo docker compose exec -T redis redis-cli <<'REDIS'
ZREMRANGEBYRANK bull:enrichment:prioritized 0 -1
DEL bull:enrichment:wait
DEL bull:enrichment:active
DEL bull:enrichment:delayed
DEL bull:enrichment:paused
REDIS

# Show remaining bull keys
sudo docker compose exec -T redis redis-cli KEYS 'bull:enrichment:*' | head -40

echo "=== reset QUEUED/RUNNING without SVG to DEFERRED ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
UPDATE "CanonicalPart" cp
SET "enrichmentStatus" = 'DEFERRED'
WHERE "enrichmentStatus" IN ('QUEUED', 'RUNNING')
  AND "infographicSpec" IS NULL;
SELECT "enrichmentStatus", COUNT(*) FROM "CanonicalPart"
WHERE id IN (
  SELECT cp.id FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id
  WHERE so.status='ACTIVE'
  GROUP BY cp.id HAVING MAX(so.price)>=300
)
GROUP BY 1 ORDER BY 2 DESC;
SQL

echo "Worker stays STOPPED until wait-and-resume brings it back after RT unlock."
