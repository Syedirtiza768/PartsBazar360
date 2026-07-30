#!/usr/bin/env node
/**
 * Throttled re-enqueue for ≥$300 parts missing SVG (incl. DEFERRED after 429).
 * Adds WAVE_SIZE jobs, waits until queue depth ≤ WAVE_RESUME_BELOW, repeats.
 */
const { Queue } = require('bullmq');
const { Client } = require('pg');
const { writeFileSync } = require('fs');

const ENRICHMENT_VERSION = 3;
const WAVE_SIZE = Number(process.env.SVG_WAVE_SIZE || 25);
const WAVE_RESUME_BELOW = Number(process.env.SVG_WAVE_RESUME_BELOW || 3);
const WAVE_PAUSE_MS = Number(process.env.SVG_WAVE_PAUSE_MS || 45_000);
const PRIORITY = Number(process.env.SVG_BATCH_PRIORITY || 20);
const STATE_PATH = process.env.SVG_BATCH_STATE || '/tmp/svg-throttle-state.json';

function jobIdFor(partId) {
  return `enrich:${partId}:v${ENRICHMENT_VERSION}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  const { rows } = await client.query(`
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
  `);
  const ids = rows.map((r) => r.id);
  console.log(`throttle_candidates=${ids.length} wave=${WAVE_SIZE} pause_ms=${WAVE_PAUSE_MS}`);

  const queue = new Queue('enrichment', {
    connection: {
      host: process.env.REDIS_HOST || 'redis',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null,
    },
  });

  let enqueued = 0;
  let wave = 0;
  const startedAt = new Date().toISOString();

  for (let i = 0; i < ids.length; ) {
    wave++;
    const slice = ids.slice(i, i + WAVE_SIZE);
    for (const partId of slice) {
      const jobId = jobIdFor(partId);
      try {
        const existing = await queue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'active' || state === 'waiting' || state === 'prioritized') {
            continue;
          }
          await existing.remove();
        }
        await queue.add(
          'enrich-part',
          { partId, reason: 'svg_batch_throttle' },
          {
            jobId,
            priority: PRIORITY,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 200,
            removeOnFail: 100,
          },
        );
        await client.query(
          `UPDATE "CanonicalPart" SET "enrichmentStatus" = 'QUEUED' WHERE id = $1`,
          [partId],
        );
        enqueued++;
      } catch (err) {
        console.error(`fail ${partId}: ${err.message || err}`);
      }
    }
    i += slice.length;
    const waiting = (await queue.getWaitingCount()) + (await queue.getPrioritizedCount());
    const active = await queue.getActiveCount();
    console.log(
      JSON.stringify({
        wave,
        enqueued,
        remaining: ids.length - i,
        waiting,
        active,
        at: new Date().toISOString(),
      }),
    );
    writeFileSync(
      STATE_PATH,
      JSON.stringify(
        { startedAt, wave, enqueued, target: ids.length, remaining: ids.length - i },
        null,
        2,
      ),
    );

    // Wait until queue nearly drained before next wave (rate-limit friendly).
    while (true) {
      const w = (await queue.getWaitingCount()) + (await queue.getPrioritizedCount());
      const a = await queue.getActiveCount();
      if (w + a <= WAVE_RESUME_BELOW) break;
      await sleep(5_000);
    }
    // Extra cool-down between waves to avoid RealTrack 429.
    if (i < ids.length) {
      console.log(`cooldown ${WAVE_PAUSE_MS}ms before next wave`);
      await sleep(WAVE_PAUSE_MS);
    }
  }

  console.log(JSON.stringify({ done: true, enqueued, waves: wave, target: ids.length }));
  await queue.close();
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
