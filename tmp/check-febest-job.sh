#!/bin/sh
set -eu
docker exec partsbazar360-api-1 sh -lc '
ps aux | grep enrich-febest | grep -v grep || true
PID=$(ps aux | grep enrich-febest-from-website | grep -v grep | awk "{print \$1}" | head -1)
echo "PID=$PID"
if [ -n "$PID" ]; then
  tr "\0" "\n" < /proc/$PID/environ | grep -E "FEBEST|SELLER|STATE" || echo "(no FEBEST env vars)"
fi
echo ----PROGRESS----
ls -la /tmp/febest* /tmp/*enrich*progress* 2>/dev/null || true
echo ----RECENT_LOGS----
ls -lt /tmp/*.log 2>/dev/null | head -15
for f in /tmp/febest-enrich-mvl.log /tmp/febest-enrich.log /tmp/febest-enrich-superior.log; do
  if [ -f "$f" ]; then
    echo "=== $f ==="
    tail -n 20 "$f"
  fi
done
'
