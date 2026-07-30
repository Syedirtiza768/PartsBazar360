#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

sudo docker compose exec -T redis redis-cli DEL bull:enrichment:delayed bull:enrichment:prioritized bull:enrichment:wait bull:enrichment:active || true

sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
UPDATE "CanonicalPart"
SET "enrichmentStatus" = 'DEFERRED'
WHERE "enrichmentStatus" IN ('QUEUED', 'RUNNING')
  AND "infographicSpec" IS NULL;
SQL

pkill -f wait-and-resume-svg || true
sleep 1
sed -i 's/\r$//' /tmp/wait-and-resume-svg.sh
: > /home/ubuntu/wait-resume-svg.log
nohup bash /tmp/wait-and-resume-svg.sh >/home/ubuntu/wait-resume-svg.log 2>&1 &
echo "wait_pid=$!"
sleep 3
tail -10 /home/ubuntu/wait-resume-svg.log
sudo docker compose ps worker || true
pgrep -af wait-and-resume || true
