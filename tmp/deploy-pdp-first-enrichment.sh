#!/bin/bash
# Deploy PDP-first enrichment queueing + drain speculative backlog.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

ENV_FILE=/home/ubuntu/PartsBazar360/.env
touch "$ENV_FILE"
# Force prewarm off unless explicitly enabled elsewhere as =1 already desired.
if grep -q '^ENRICHMENT_PREWARM=' "$ENV_FILE"; then
  sed -i 's/^ENRICHMENT_PREWARM=.*/ENRICHMENT_PREWARM=0/' "$ENV_FILE"
else
  echo 'ENRICHMENT_PREWARM=0' >> "$ENV_FILE"
fi
grep -q '^ENRICHMENT_PREWARM_MAX_BACKLOG=' "$ENV_FILE" || echo 'ENRICHMENT_PREWARM_MAX_BACKLOG=4' >> "$ENV_FILE"

echo "=== rebuild api + worker (buyer unchanged) ==="
sudo docker compose build api worker
sudo docker compose up -d api worker

echo "=== wait for api health ==="
for i in $(seq 1 40); do
  CID=$(sudo docker compose ps -q api)
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 5
done

echo "=== drain speculative waiting/prioritized enrichment jobs ==="
# Keep active jobs (someone may already be mid-OpenRouter call). Drop waiting
# backlog so the next PDP view is not buried. Reset orphan QUEUED rows to NONE.
python3 <<'PY'
import json, subprocess

def redis(*args):
    out = subprocess.check_output(
        ["sudo","docker","compose","exec","-T","redis","redis-cli",*args],
        cwd="/home/ubuntu/PartsBazar360",
        text=True,
    ).strip()
    return out

# Collect job ids from prioritized zset + wait list
ids = set()
raw = redis("ZRANGE", "bull:enrichment:prioritized", "0", "-1")
if raw:
    ids.update([x for x in raw.splitlines() if x.startswith("enrich:")])
# wait is a list in bullmq 5 — also check waiting-children etc.
for key in ("bull:enrichment:wait", "bull:enrichment:paused"):
    n = int(redis("LLEN", key) or 0)
    if n:
        vals = redis("LRANGE", key, "0", "-1")
        ids.update([x for x in vals.splitlines() if x.startswith("enrich:")])

removed = 0
part_ids = []
for jid in sorted(ids):
    # jid like enrich:<uuid>:v2
    parts = jid.split(":")
    if len(parts) >= 3:
        part_ids.append(parts[1])
    # remove job hash + from prioritized
    redis("DEL", f"bull:enrichment:{jid}")
    redis("ZREM", "bull:enrichment:prioritized", jid)
    removed += 1

print(f"removed_waiting_jobs={removed}")
open("/tmp/enrich-reset-ids.txt","w").write("\n".join(part_ids))
print(f"parts_to_reset={len(part_ids)}")
PY

if [ -s /tmp/enrich-reset-ids.txt ]; then
  # Build a SQL list
  IDS=$(python3 -c "print(','.join([\"'\"+l.strip()+\"'\" for l in open('/tmp/enrich-reset-ids.txt') if l.strip()]))")
  sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
    "UPDATE \"CanonicalPart\" SET \"enrichmentStatus\"='NONE' WHERE id IN ($IDS) AND \"enrichmentStatus\"='QUEUED';"
fi

echo "=== queue after drain ==="
echo wait=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:wait)
echo active=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active)
echo prioritized=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized)
echo PREWARM=$(grep ENRICHMENT_PREWARM /home/ubuntu/PartsBazar360/.env | head -1)

echo "=== DONE — PDP views now enqueue/promote at priority 1; prewarm off ==="
