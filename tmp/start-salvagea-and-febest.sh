#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
docker compose up -d api
sleep 12
docker compose ps api
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c 'SELECT COUNT(*) AS mvl FROM "MvlVehicle";'

cat > /tmp/check-mvl-prisma.mjs <<'NODE'
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const c = await p.mvlVehicle.count();
console.log(JSON.stringify({ mvlVehicle: c }));
await p.$disconnect();
NODE
docker cp /tmp/check-mvl-prisma.mjs partsbazar360-api-1:/tmp/check-mvl-prisma.mjs
docker exec -w /tmp partsbazar360-api-1 node check-mvl-prisma.mjs

# Start SalvageA sync
docker exec -d partsbazar360-api-1 bash -lc 'SEED_REPORT_PATH=/tmp/seed-salvagea-report.json npm run seed:salvagea > /tmp/seed-salvagea.log 2>&1'
sleep 5
docker exec partsbazar360-api-1 bash -lc 'ps aux | grep -E "seed-salvagea|seed-salvage" | grep -v grep || true; tail -n 30 /tmp/seed-salvagea.log || true'

# Start FEBEST enrich (MVL verify)
docker exec -d partsbazar360-api-1 bash -lc 'FEBEST_FORCE=1 FEBEST_DELAY_MS=300 FEBEST_CONCURRENCY=2 npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 4
docker exec partsbazar360-api-1 bash -lc 'tail -n 20 /tmp/febest-enrich-mvl.log || true'
echo JOBS_STARTED
