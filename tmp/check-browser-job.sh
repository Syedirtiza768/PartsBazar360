#!/bin/bash
set -e
echo "=== process ==="
ps -p 410915 -o pid,etime,cmd --no-headers 2>/dev/null || ps aux | grep -F enrich-dxb-partsouq-browser | grep -v grep | head -3
echo "=== log ==="
tail -12 /tmp/dxb-partsouq-browser.log
echo "=== progress ==="
/tmp/oem-venv/bin/python - <<'PY'
import json
from pathlib import Path
p = Path("/tmp/dxb-partsouq-browser-progress.json")
if not p.exists():
    print("no progress file")
else:
    d = json.loads(p.read_text())
    print(
        {
            "ok": d.get("ok"),
            "fail": d.get("fail"),
            "notFound": d.get("notFound"),
            "skipped": d.get("skipped"),
            "updatedAt": d.get("updatedAt"),
            "done": len(d.get("done") or []),
        }
    )
PY

PG_IP=$(sudo docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' partsbazar360-postgres-1)
DBURL=$(sudo docker exec partsbazar360-api-1 printenv DATABASE_URL | sed "s/@postgres:/@${PG_IP}:/")
export DATABASE_URL="$DBURL"
/tmp/oem-venv/bin/python - <<'PY'
import os
import psycopg

conn = psycopg.connect(os.environ["DATABASE_URL"])
with conn.cursor() as cur:
    cur.execute(
        """
        UPDATE "CanonicalPart"
        SET title = regexp_replace(title, ' Chat$', '')
        WHERE title ILIKE '% Chat'
          AND "fitmentFlags" @> ARRAY['PARTSOUQ_BROWSER']::text[]
        """
    )
    print("chat_fixed", cur.rowcount)
    cur.execute(
        """
        SELECT
          count(*) FILTER (WHERE c."imageUrls"::text ILIKE '%partsouq%'),
          count(*) FILTER (WHERE c.compatibility::text ILIKE '%partsouq.com%'),
          count(*) FILTER (WHERE c."fitmentFlags" @> ARRAY['PARTSOUQ_BROWSER']::text[])
        FROM "CanonicalPart" c
        JOIN "SellerOffer" o ON o."canonicalPartId"=c.id
        JOIN "SourceRecord" sr ON sr."sellerOfferId"=o.id
        WHERE sr."sourceFileName"='DXB-EXW.xlsx'
        """
    )
    print("images,compat,flagged", cur.fetchone())
conn.commit()
conn.close()
PY
