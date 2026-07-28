#!/bin/sh
set -eu

docker exec -w /app partsbazar360-api-1 node -e "const {PrismaClient}=require('@prisma/client'); const {PrismaPg}=require('@prisma/adapter-pg'); const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}); p.mvlVehicle.count().then(c=>{console.log(JSON.stringify({mvlVehicle:c})); return p.\$disconnect();}).catch(e=>{console.error(e); process.exit(1);});"

docker exec partsbazar360-api-1 ls -la dist/src/seed-salvagea.cli.js scripts/enrich-febest-from-website.mjs

docker exec -d partsbazar360-api-1 sh -lc 'SEED_REPORT_PATH=/tmp/seed-salvagea-report.json npm run seed:salvagea > /tmp/seed-salvagea.log 2>&1'
sleep 8
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep -E "seed-salvagea|seed-salvage" | grep -v grep || true; echo ----; tail -n 50 /tmp/seed-salvagea.log || true'

docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_FORCE=1 FEBEST_DELAY_MS=300 FEBEST_CONCURRENCY=2 npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 6
docker exec partsbazar360-api-1 sh -lc 'echo ----FEBEST----; tail -n 40 /tmp/febest-enrich-mvl.log || true'
echo JOBS_STARTED
