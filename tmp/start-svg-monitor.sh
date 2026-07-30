#!/bin/bash
# Background SVG batch progress poller
if pgrep -f 'monitor-svg-batch.sh' >/dev/null 2>&1; then
  echo "monitor already running"
  pgrep -af 'monitor-svg-batch'
  exit 0
fi
nohup bash -c 'while true; do bash /tmp/monitor-svg-batch.sh >/tmp/svg-batch-monitor-last.txt 2>&1; sleep 60; done' \
  >/tmp/svg-batch-monitor-loop.log 2>&1 &
echo "started pid=$!"
