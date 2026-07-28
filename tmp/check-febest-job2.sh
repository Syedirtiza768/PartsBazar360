#!/bin/bash
set -eu
docker exec partsbazar360-api-1 sh -lc '
echo "==== PROCESSES ===="
ps aux | grep enrich-febest | grep -v grep || true
for PID in $(ps aux | grep enrich-febest-from-website | grep -v grep | awk "{print \$1}"); do
  echo "---- PID $PID env ----"
  tr "\0" "\n" < /proc/$PID/environ | grep -E "FEBEST|SELLER|STATE" || echo "(none)"
done
echo "==== SUPERIOR PROGRESS ===="
cat /tmp/febest-enrich-superior-progress.json 2>/dev/null || echo none
echo
echo "==== MVL LOG ===="
tail -n 40 /tmp/febest-enrich-mvl.log 2>/dev/null || true
'

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name,
       COUNT(*) FILTER (WHERE o.status='ACTIVE') AS active_offers,
       COUNT(*) FILTER (WHERE o.status='ACTIVE' AND p.compatibility IS NOT NULL AND p.compatibility::text NOT IN ('null','[]','{}')) AS with_compat
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
JOIN \"CanonicalPart\" p ON p.id=o.\"canonicalPartId\"
WHERE p.brand ILIKE '%FEBEST%'
GROUP BY 1
ORDER BY 2 DESC;
"
