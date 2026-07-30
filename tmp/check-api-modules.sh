#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T api sh -c 'ls node_modules/pg/package.json; ls node_modules/bullmq/package.json; node -p process.version'
