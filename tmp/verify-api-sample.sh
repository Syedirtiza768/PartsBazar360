#!/bin/bash
set -eu
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?brand=FEBEST&limit=1"' | head -c 1800
echo
echo ----
docker exec partsbazar360-api-1 sh -lc 'tr "\0" "\n" < /proc/$(ps aux | grep enrich-febest-from-website | grep -v grep | awk "{print \$1}" | head -1)/environ | grep FEBEST'
