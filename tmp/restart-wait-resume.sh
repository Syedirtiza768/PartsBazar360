#!/bin/bash
set -euo pipefail
pkill -f wait-and-resume-svg || true
sleep 1
sed -i 's/\r$//' /tmp/wait-and-resume-svg.sh
: > /home/ubuntu/wait-resume-svg.log
nohup bash /tmp/wait-and-resume-svg.sh >/home/ubuntu/wait-resume-svg.log 2>&1 &
echo "wait_pid=$!"
sleep 5
cat /home/ubuntu/wait-resume-svg.log
pgrep -af wait-and-resume || true
