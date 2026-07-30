#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT
  COUNT(*) FILTER (WHERE "costUsd" IS NOT NULL AND "costUsd" > 0) AS jobs_with_cost,
  ROUND(AVG("costUsd") FILTER (WHERE "costUsd" > 0)::numeric, 6) AS avg_cost,
  ROUND(SUM("costUsd") FILTER (WHERE "costUsd" > 0)::numeric, 4) AS sum_cost,
  ROUND(MIN("costUsd") FILTER (WHERE "costUsd" > 0)::numeric, 6) AS min_cost,
  ROUND(MAX("costUsd") FILTER (WHERE "costUsd" > 0)::numeric, 6) AS max_cost
FROM "EnrichmentJob";

SELECT status, COUNT(*) AS n,
  ROUND(AVG("costUsd") FILTER (WHERE "costUsd" > 0)::numeric, 6) AS avg_cost
FROM "EnrichmentJob"
WHERE "finishedAt" > NOW() - INTERVAL '30 days'
GROUP BY status
ORDER BY n DESC;

SELECT
  ROUND(("resultMeta"->>'costUsd')::numeric, 6) AS cost,
  LEFT(COALESCE("resultMeta"->>'provider',''), 40) AS provider,
  status
FROM "EnrichmentJob"
WHERE "resultMeta"->>'costUsd' IS NOT NULL
ORDER BY "finishedAt" DESC NULL 10;
SQL
