#!/bin/bash
# Snapshot SVG-batch progress + costs to /tmp/svg-batch-progress.json
set -euo pipefail
cd /home/ubuntu/PartsBazar360

DAY=$(date -u +%Y-%m-%d)
SPEND=$(sudo docker compose exec -T redis redis-cli GET "enrich:spend:${DAY}" 2>/dev/null | tr -d '\r' || echo 0)
SPEND=${SPEND:-0}
WAIT=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:wait | tr -d '\r')
PRIO=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized | tr -d '\r')
ACTIVE=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active | tr -d '\r')
FAILED=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:failed | tr -d '\r' || echo 0)

# RT budget
sudo docker compose exec -T worker printenv REALTRACK_API_URL > /tmp/mon_rt_url 2>/dev/null || true
sudo docker compose exec -T worker printenv REALTRACK_API_EMAIL > /tmp/mon_rt_email 2>/dev/null || true
sudo docker compose exec -T worker printenv REALTRACK_API_PASSWORD > /tmp/mon_rt_pass 2>/dev/null || true
python3 - <<'PY' > /tmp/rt-budget.json
import json, urllib.request, urllib.error, os
try:
    base = open("/tmp/mon_rt_url").read().strip().replace("\r","").rstrip("/")
    if not base.startswith("http"):
        raise ValueError(f"bad base {base!r}")
    email = open("/tmp/mon_rt_email").read().strip().replace("\r","")
    password = open("/tmp/mon_rt_pass").read().strip().replace("\r","")
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
        print(json.dumps(json.load(res)))
except Exception as e:
    print(json.dumps({"error": str(e), "used": None, "remaining": None, "limit": 4500}))
PY

sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A <<'SQL' > /tmp/svg-db-stats.txt
WITH active_parts AS (
  SELECT
    cp.id,
    MAX(so.price) AS top_price,
    BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg,
    MAX(cp."enrichmentStatus") AS status,
    MAX(cp."enrichmentSource") AS source
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so.status = 'ACTIVE'
  GROUP BY cp.id
)
SELECT
  count(*) FILTER (WHERE top_price >= 300) || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND has_svg) || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg) || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'QUEUED') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'RUNNING') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'DONE') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'FAILED') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'DEFERRED') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND has_svg AND source ILIKE '%infographic%') || '|' ||
  count(*) FILTER (WHERE top_price >= 300 AND status = 'DONE' AND source ILIKE '%realtrack%')
FROM active_parts;
SQL

IFS='|' read -r GE300 HAVE NEED QUEUED RUNNING DONE FAILED_DB DEFERRED WITH_INFO RT_DONE < /tmp/svg-db-stats.txt
RT_JSON=$(cat /tmp/rt-budget.json)

python3 - <<PY
import json, os
from datetime import datetime, timezone

ge300, have, need, queued, running, done, failed_db, deferred, with_info, rt_done = [
    int(x) for x in """$GE300|$HAVE|$NEED|$QUEUED|$RUNNING|$DONE|$FAILED_DB|$DEFERRED|$WITH_INFO|$RT_DONE""".split("|")
]
rt = json.loads('''$RT_JSON''')
spend = float("$SPEND" or 0)
target_have_start = None
state = {}
try:
    with open("/tmp/svg-batch-state.json") as f:
        state = json.load(f)
except Exception:
    pass

progress = {
    "updatedAt": datetime.now(timezone.utc).isoformat(),
    "queue": {
        "waiting": int("$WAIT" or 0),
        "prioritized": int("$PRIO" or 0),
        "active": int("$ACTIVE" or 0),
        "failed": int("$FAILED" or 0),
    },
    "partsGe300": {
        "total": ge300,
        "haveSvg": have,
        "needSvg": need,
        "queued": queued,
        "running": running,
        "done": done,
        "failed": failed_db,
        "deferred": deferred,
        "withInfographicSource": with_info,
        "realtrackDone": rt_done,
    },
    "openRouterSpendUsd": spend,
    "openRouterBudgetUsd": 25,
    "realtrackBudget": rt if isinstance(rt, dict) and "remaining" in rt else rt.get("data", rt),
    "enqueueState": state,
    "pctComplete": round(100.0 * have / ge300, 2) if ge300 else 0,
}
print(json.dumps(progress, indent=2))
with open("/tmp/svg-batch-progress.json", "w") as f:
    json.dump(progress, f, indent=2)
# append history
hist = []
try:
    with open("/tmp/svg-batch-history.jsonl") as f:
        hist = f.readlines()[-200:]
except Exception:
    pass
with open("/tmp/svg-batch-history.jsonl", "a") as f:
    f.write(json.dumps({
        "t": progress["updatedAt"],
        "haveSvg": have,
        "needSvg": need,
        "spend": spend,
        "wait": progress["queue"]["waiting"] + progress["queue"]["prioritized"],
        "active": progress["queue"]["active"],
        "rtRemaining": (progress["realtrackBudget"] or {}).get("remaining"),
    }) + "\n")
PY
