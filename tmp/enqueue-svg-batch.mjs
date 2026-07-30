#!/usr/bin/env node
/**
 * Enqueue RealTrack+SVG enrichment for active ≥$300 parts missing infographicSpec.
 * Skips location diagrams via LOCATION_DIAGRAM_MIN_PRICE_USD on the worker.
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createConnection } from 'net';

const require = createRequire(import.meta.url);
const { Queue } = require('bullmq');
const { Client } = require('pg');

const ENRICHMENT_VERSION = 3;
const STATE_PATH = process.env.SVG_BATCH_STATE || '/tmp/svg-batch-state.json';
const LIMIT = Number(process.env.SVG_BATCH_LIMIT || 0) || 0; // 0 = all
const PRIORITY = Number(process.env.SVG_BATCH_PRIORITY || 20);
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

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

  const q = `
    SELECT cp.id
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    WHERE so.status = 'ACTIVE'
      AND cp."infographicSpec" IS NULL
    GROUP BY cp.id
    HAVING MAX(so.price) >= 300
       AND BOOL_OR(
         so."externalOfferId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR so."sourceKey" ~ 'rt:[^:]+:[0-9a-f-]{36}'
       )
    ORDER BY MAX(so.price) DESC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}
  `;

  const { rows } = await client.query(q);
  const ids = rows.map((r) => r.id);
  console.log(`candidates=${ids.length} priority=${PRIORITY} limit=${LIMIT || 'all'}`);

  const queue = new Queue('enrichment', {
    connection: { host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null },
  });

  let enqueued = 0;
  let removed = 0;
  let errors = 0;

  for (const partId of ids) {
    const jobId = jobIdFor(partId);
    try {
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'active') {
          continue;
        }
        await existing.remove();
        removed++;
      }
      await queue.add(
        'enrich-part',
        { partId, reason: 'svg_batch' },
        {
          jobId,
          priority: PRIORITY,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 200,
        },
      );
      await client.query(
        `UPDATE "CanonicalPart" SET "enrichmentStatus" = 'QUEUED' WHERE id = $1`,
        [partId],
      );
      enqueued++;
      if (enqueued % 200 === 0) {
        console.log(`progress enqueued=${enqueued}/${ids.length}`);
      }
    } catch (err) {
      errors++;
      console.error(`fail ${partId}: ${err.message || err}`);
    }
  }

  const state = {
    startedAt: new Date().toISOString(),
    target: ids.length,
    enqueued,
    removedPriorJobs: removed,
    errors,
    priority: PRIORITY,
    enrichmentVersion: ENRICHMENT_VERSION,
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));

  await queue.close();
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
