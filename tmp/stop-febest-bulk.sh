#!/bin/bash
set -euo pipefail
echo 'Stopping bulk FEBEST enricher...'
PIDS=$(pgrep -f 'enrich-febest-from-website.mjs' || true)
if [ -n "${PIDS:-}" ]; then
  echo "Killing: $PIDS"
  sudo kill $PIDS || true
  sleep 2
  pgrep -f 'enrich-febest-from-website.mjs' && echo 'still running' || echo 'stopped'
else
  echo 'not running'
fi
echo '--- last log ---'
tail -n 5 /home/ubuntu/febest-enrich.log || true
