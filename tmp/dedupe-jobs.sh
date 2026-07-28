#!/bin/sh
# Keep newest enrich + backfill only
docker exec partsbazar360-api-1 sh -lc '
  for name in enrich-febest-from-website backfill-compat-from-mvl; do
    pids=$(ps aux | grep "$name" | grep -v grep | awk "{print \$1}" | sort -n)
    set -- $pids
    if [ $# -gt 1 ]; then
      # kill all but last
      while [ $# -gt 1 ]; do
        echo kill_old $1
        kill $1 || true
        shift
      done
      echo keep $1
    fi
  done
  sleep 2
  ps aux | grep -E "seed-salvagea|enrich-febest|backfill-compat" | grep -v grep || true
'
sleep 15
docker exec partsbazar360-api-1 sh -lc 'tail -n 12 /tmp/febest-enrich-mvl.log; echo ---; tail -n 10 /tmp/backfill-compat-mvl.log'
