#!/usr/bin/env bash
set -euo pipefail
# Rebuild API image on EC2 with local synced sources already in /home/ubuntu/PartsBazar360

cd /home/ubuntu/PartsBazar360 || cd ~/partsbazar360 || cd /opt/partsbazar360 || {
  echo "REPO_NOT_FOUND"; ls -la ~; exit 1
}
pwd
ls apps/api/src/modules/ingestion/mvl-fitment.service.ts
docker compose build api
docker compose up -d api
docker compose ps api
echo REBUILD_DONE
