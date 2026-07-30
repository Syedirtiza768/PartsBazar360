#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== worker env ==="
sudo docker compose exec -T worker sh -c 'echo ENRICHMENT_ENABLED=$ENRICHMENT_ENABLED; echo PROVIDER=$ENRICHMENT_PROVIDER; echo CONCURRENCY=$ENRICHMENT_CONCURRENCY; echo LOCATION_DIAGRAM_MIN=$LOCATION_DIAGRAM_MIN_PRICE_USD; echo INFOGRAPHIC_MIN=$INFOGRAPHIC_MIN_PRICE_USD; echo KEY=$([ -n "$OPENROUTER_API_KEY" ] && echo yes || echo no)'

echo "=== queue ==="
sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:wait
sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized
sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active
sudo docker compose exec -T redis redis-cli GET enrichment:spend:$(date -u +%Y-%m-%d) || true

echo "=== RT budget ==="
sudo docker compose exec -T worker printenv REALTRACK_API_URL > /tmp/rt_url
sudo docker compose exec -T worker printenv REALTRACK_API_EMAIL > /tmp/rt_email
sudo docker compose exec -T worker printenv REALTRACK_API_PASSWORD > /tmp/rt_pass
BASE=$(tr -d '\r\n' </tmp/rt_url); BASE="${BASE%/}"

python3 <<'PY'
import json, urllib.request
base = open("/tmp/rt_url").read().strip().replace("\r","")
base = base.rstrip("/")
email = open("/tmp/rt_email").read().strip().replace("\r","")
password = open("/tmp/rt_pass").read().strip().replace("\r","")
req = urllib.request.Request(
    f"{base}/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as res:
    token = json.load(res)["accessToken"]
r = urllib.request.Request(
    f"{base}/published-listings/trading-enrichment/budget",
    headers={"Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(r, timeout=30) as res:
    print(json.dumps(json.load(res), indent=2))
PY

echo "=== candidate counts ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
WITH active_parts AS (
  SELECT
    cp.id,
    MAX(so.price) AS top_price,
    BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg,
    MAX(cp."enrichmentStatus") AS status,
    MAX(cp."enrichmentVersion") AS ver,
    BOOL_OR(
      so."externalOfferId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR so."sourceKey" ~ 'rt:[^:]+:[0-9a-f-]{36}'
    ) AS has_rt_id
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so.status = 'ACTIVE'
  GROUP BY cp.id
)
SELECT
  count(*) FILTER (WHERE top_price >= 300) AS ge_300,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg) AS need_svg,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND has_rt_id) AS need_svg_with_rt,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND NOT has_rt_id) AS need_svg_no_rt,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND status = 'DONE') AS need_svg_already_done,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND status IN ('QUEUED','RUNNING')) AS in_flight
FROM active_parts;
SQL
