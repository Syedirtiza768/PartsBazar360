#!/usr/bin/env node
/**
 * Bulk-enqueue enrichment for all active parts missing weight/itemSpecifics.
 * Runs inside the API container where it can reach Postgres + Redis directly.
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { Queue } = require('bullmq');
const { Client } = require('pg');

const ENRICHMENT_VERSION = 3;
const LIMIT = Number(process.env.ENRICH_LIMIT || 0) || 0; // 0 = all
const PRIORITY = Number(process.env.ENRICH_PRIORITY || 30);
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const DRY_RUN = process.env.DRY_RUN === '1';

function jobIdFor(partId) {
  return `enrich:${partId}:v${ENRICHMENT_VERSION}`;
}

async function main() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'partsbazar_user',
    password: process.env.POSTGRES_PASSWORD || 'partsbazar_password',
    database: process.env.POSTGRES_DB || 'partsbazar_db',
  });
  await client.connect();

  // Find all active parts that need enrichment
  const q = `
    SELECT cp.id, cp."enrichmentStatus", cp.weight IS NOT NULL as has_weight,
           cp."itemSpecifics" IS NOT NULL as has_specifics
    FROM "CanonicalPart" cp
    WHERE EXISTS (
      SELECT 1 FROM "SellerOffer" so
      WHERE so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
    )
    AND (
      cp."enrichmentStatus" IN ('NONE', 'QUEUED', 'FAILED', 'DEFERRED')
      OR (cp."enrichmentStatus" = 'DONE' AND cp."enrichmentVersion" < ${ENRICHMENT_VERSION})
      OR (cp."enrichmentStatus" = 'DONE' AND cp."itemSpecifics" IS NULL)
    )
    ORDER BY cp."enrichmentStatus" = 'FAILED' DESC, cp."updatedAt" ASC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}
  `;

  const { rows } = await client.query(q);
  console.log(`Found ${rows.length} parts needing enrichment`);

  if (DRY_RUN) {
    const statusCounts = {};
    for (const r of rows) {
      statusCounts[r.enrichmentStatus] = (statusCounts[r.enrichmentStatus] || 0) + 1;
    }
    console.log('Status breakdown:', JSON.stringify(statusCounts));
    console.log('DRY_RUN=1 — no jobs enqueued');
    await client.end();
    return;
  }

  const queue = new Queue('enrichment', {
    connection: { host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null },
  });

  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const partId = row.id;
    const jobId = jobIdFor(partId);
    try {
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'active' || state === 'waiting' || state === 'prioritized') {
          skipped++;
          continue;
        }
        await existing.remove();
      }
      await queue.add(
        'enrich-part',
        { partId, reason: 'bulk_intake' },
        {
          jobId,
          priority: PRIORITY,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 500,
        },
      );
      await client.query(
        `UPDATE "CanonicalPart" SET "enrichmentStatus" = 'QUEUED' WHERE id = $1 AND "enrichmentStatus" NOT IN ('QUEUED', 'RUNNING')`,
        [partId],
      );
      enqueued++;
      if (enqueued % 500 === 0) {
        console.log(`progress: enqueued=${enqueued}/${rows.length} skipped=${skipped} errors=${errors}`);
      }
    } catch (err) {
      errors++;
      if (errors <= 10) console.error(`fail ${partId}: ${err.message || err}`);
    }
  }

  const report = {
    startedAt: new Date().toISOString(),
    totalCandidates: rows.length,
    enqueued,
    skippedAlreadyRunning: skipped,
    errors,
    priority: PRIORITY,
    enrichmentVersion: ENRICHMENT_VERSION,
    dryRun: false,
  };
  writeFileSync('/tmp/enrich-batch-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));

  await queue.close();
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
