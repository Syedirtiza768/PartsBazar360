#!/usr/bin/env node

/**
 * Resumable Superior Auto Parts OE -> You.com -> MVL recovery job.
 *
 * Modes:
 *   --init                         Create a job and queue unmatched OE-bearing listings.
 *   --run                          Process queued research and attach exact MVL rows.
 *   --run --no-research            Process research already ingested from a feed.
 *   --status JOB_ID                Print durable progress and ETA.
 *   --export JOB_ID --limit N      Export pending OE requests for the task layer.
 *   --ingest JOB_ID --file FILE    Ingest You.com JSON results into the job queue.
 *
 * The writer is deliberately conservative: a research result must contain a
 * bounded year range and an exact normalized make/model hit in MvlVehicle.
 * Every attached row stores the OE number and You.com source metadata in both
 * CanonicalPart.compatibility and FitmentEvidence.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';

const SELLER_ID = process.env.MVL_SELLER_ID || 'seller-superior-auto-parts';
const YDC_API_KEY = process.env.YDC_API_KEY || '';
const YDC_URL = 'https://api.you.com/v1/research';
const DEFAULT_WORKERS = Math.max(1, Math.min(Number(process.env.MVL_WORKERS || 4), 16));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MVL_MAX_ATTEMPTS || 3));
const RESEARCH_EFFORT = process.env.MVL_RESEARCH_EFFORT || 'standard';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return clean(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMaybeJson(value) {
  if (value && typeof value === 'object') return value;
  const raw = clean(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceUrls(research) {
  const output = asObject(research?.output);
  const sources = asArray(research?.sources).concat(asArray(output.sources));
  return [...new Set(sources.map((source) => clean(source?.url || source)).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 12);
}

function primaryOeNumber(item) {
  const candidates = asObject(item.oe_candidates ?? item.oeCandidates);
  return asArray(candidates.oeNumbers).map(clean).find(Boolean)
    || clean(candidates.manufacturerPartNumber)
    || clean(item.mpn);
}

function applicationsFromResearch(research) {
  const output = asObject(research?.output);
  const content = output.content ?? research?.content ?? research;
  const object = typeof content === 'string' ? parseMaybeJson(content) : asObject(content);
  return asArray(object.applications || research?.applications).map((application) => ({
    make: clean(application?.make),
    model: clean(application?.model),
    from: Number(application?.from ?? application?.yearFrom ?? application?.startYear),
    to: Number(application?.to ?? application?.yearTo ?? application?.endYear),
    notes: clean(application?.notes),
  })).filter((application) => application.make && application.model
    && Number.isInteger(application.from) && Number.isInteger(application.to)
    && application.from >= 1950 && application.to <= 2035 && application.to >= application.from);
}

function buildResearchInput(item) {
  const candidates = asObject(item.oeCandidates);
  const numbers = [...new Set([
    clean(candidates.manufacturerPartNumber),
    ...asArray(candidates.oeNumbers).map(clean),
  ].filter((value) => value && value.length <= 80))];
  return `Find reliable vehicle applications for the exact automotive part identifiers below.\n\n`
    + `Listing title: ${clean(item.title)}\nBrand: ${clean(item.brand)}\nManufacturer part number: ${clean(item.mpn)}\n`
    + `OE/cross-reference numbers: ${numbers.join(', ')}\n\n`
    + `Return only a JSON object with this shape: {"status":"MATCHED" or "NO_RELIABLE_COMPLETE_YMM",`
    + `"applications":[{"make":"...","model":"...","from":2000,"to":2005,"notes":"..."}],`
    + `"sources":[{"title":"...","url":"https://..."}]}. `
    + `Use complete bounded year ranges only. Do not infer an end year, do not broaden from a similar part, and use NO_RELIABLE_COMPLETE_YMM when an exact bounded application cannot be established.`;
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'applications', 'sources'],
  properties: {
    status: { type: 'string', enum: ['MATCHED', 'NO_RELIABLE_COMPLETE_YMM'] },
    applications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['make', 'model', 'from', 'to', 'notes'],
        properties: {
          make: { type: 'string' },
          model: { type: 'string' },
          from: { type: 'integer' },
          to: { type: 'integer' },
          notes: { type: 'string' },
        },
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url'],
        properties: { title: { type: 'string' }, url: { type: 'string' } },
      },
    },
  },
};

async function callYouResearch(item) {
  if (!YDC_API_KEY) throw new Error('YDC_API_KEY is not configured; use --export/--ingest or configure the production key');
  const response = await fetch(YDC_URL, {
    method: 'POST',
    headers: { 'X-API-Key': YDC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: buildResearchInput(item), research_effort: RESEARCH_EFFORT, output_schema: outputSchema }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`You.com ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "MvlOeRecoveryJob" (
      id uuid PRIMARY KEY,
      seller_id text NOT NULL,
      status text NOT NULL DEFAULT 'QUEUED',
      total_items integer NOT NULL DEFAULT 0,
      processed_items integer NOT NULL DEFAULT 0,
      attached_listings integer NOT NULL DEFAULT 0,
      attached_rows integer NOT NULL DEFAULT 0,
      skipped_items integer NOT NULL DEFAULT 0,
      failed_items integer NOT NULL DEFAULT 0,
      started_at timestamptz,
      completed_at timestamptz,
      last_heartbeat_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "MvlOeRecoveryItem" (
      id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES "MvlOeRecoveryJob"(id) ON DELETE CASCADE,
      canonical_part_id text NOT NULL,
      title text,
      brand text,
      mpn text,
      oe_candidates jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'PENDING',
      attempts integer NOT NULL DEFAULT 0,
      research_output jsonb,
      mvl_rows integer NOT NULL DEFAULT 0,
      last_error text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(job_id, canonical_part_id)
    );
    CREATE INDEX IF NOT EXISTS "MvlOeRecoveryItem_claim_idx"
      ON "MvlOeRecoveryItem"(job_id, status, next_attempt_at, id);
  `);
}

async function initJob() {
  const client = await connect();
  try {
    await ensureSchema(client);
    const jobId = crypto.randomUUID();
    await client.query(`INSERT INTO "MvlOeRecoveryJob" (id, seller_id, status, started_at, last_heartbeat_at)
      VALUES ($1, $2, 'QUEUED', now(), now())`, [jobId, SELLER_ID]);
    await client.query(`
      INSERT INTO "MvlOeRecoveryItem" (id, job_id, canonical_part_id, title, brand, mpn, oe_candidates)
      SELECT gen_random_uuid(), $1, cp.id, cp.title, cp.brand, cp."manufacturerPartNumber",
             jsonb_build_object('manufacturerPartNumber', cp."manufacturerPartNumber", 'oeNumbers', to_jsonb(cp."oeNumbers"))
      FROM "CanonicalPart" cp
      WHERE (COALESCE(array_length(cp."oeNumbers", 1), 0) > 0
             OR NULLIF(btrim(cp."manufacturerPartNumber"), '') IS NOT NULL)
        AND EXISTS (SELECT 1 FROM "SellerOffer" so
                    WHERE so."canonicalPartId" = cp.id AND so."sellerId" = $2 AND so.status = 'ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM "Fitment" f
                        WHERE f."canonicalPartId" = cp.id AND f.source = 'MVL_BACKFILL')
      ON CONFLICT (job_id, canonical_part_id) DO NOTHING`, [jobId, SELLER_ID]);
    await client.query(`UPDATE "MvlOeRecoveryJob" SET total_items = (SELECT count(*) FROM "MvlOeRecoveryItem" WHERE job_id = $1), updated_at = now() WHERE id = $1`, [jobId]);
    const { rows: [job] } = await client.query(`SELECT id, status, total_items FROM "MvlOeRecoveryJob" WHERE id = $1`, [jobId]);
    console.log(JSON.stringify({ event: 'job_created', jobId: job.id, status: job.status, totalItems: job.total_items }));
    return jobId;
  } finally { await client.end(); }
}

async function status(jobId) {
  const client = await connect();
  try {
    await ensureSchema(client);
    const { rows: [job] } = await client.query(`SELECT * FROM "MvlOeRecoveryJob" WHERE id = $1`, [jobId]);
    if (!job) throw new Error(`job not found: ${jobId}`);
    const { rows: [counts] } = await client.query(`
      SELECT count(*) FILTER (WHERE status IN ('PENDING','RETRY','RESEARCHING','RESEARCHED'))::int AS remaining,
             count(*) FILTER (WHERE status = 'ATTACHED')::int AS attached_items,
             count(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped_items,
             count(*) FILTER (WHERE status = 'FAILED')::int AS failed_items,
             COALESCE(sum(mvl_rows), 0)::int AS attached_rows
      FROM "MvlOeRecoveryItem" WHERE job_id = $1`, [jobId]);
    const processed = Number(counts.attached_items) + Number(counts.skipped_items) + Number(counts.failed_items);
    const elapsed = job.started_at ? (Date.now() - new Date(job.started_at).getTime()) / 1000 : 0;
    const rate = elapsed > 30 ? processed / elapsed : 0;
    const etaSeconds = processed >= 20 && rate > 0 ? Number(counts.remaining) / rate : null;
    console.log(JSON.stringify({
      event: 'job_status', jobId: job.id, status: job.status, totalItems: job.total_items,
      remaining: Number(counts.remaining), processed, attachedListings: Number(counts.attached_items),
      attachedRows: Number(counts.attached_rows), skipped: Number(counts.skipped_items),
      failed: Number(counts.failed_items), rateItemsPerMinute: Math.round(rate * 60 * 100) / 100,
      etaMinutes: etaSeconds == null ? null : Math.ceil(etaSeconds / 60),
      lastHeartbeat: job.last_heartbeat_at, startedAt: job.started_at, completedAt: job.completed_at,
      ydcConfigured: Boolean(YDC_API_KEY),
    }));
  } finally { await client.end(); }
}

async function exportPending(jobId, limit) {
  const client = await connect();
  try {
    await ensureSchema(client);
    const { rows } = await client.query(`SELECT id, canonical_part_id AS "canonicalPartId", title, brand, mpn, oe_candidates AS "oeCandidates"
      FROM "MvlOeRecoveryItem" WHERE job_id = $1 AND status IN ('PENDING','RETRY') ORDER BY id LIMIT $2`, [jobId, limit]);
    console.log(JSON.stringify({ jobId, items: rows }));
  } finally { await client.end(); }
}

async function ingest(jobId, file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const items = asArray(raw.items || raw);
  const client = await connect();
  let accepted = 0;
  try {
    await ensureSchema(client);
    for (const item of items) {
      const partId = clean(item.canonicalPartId || item.id);
      if (!partId) continue;
      const research = {
        output: { content: asObject(item.content || item.output || item) },
        sources: asArray(item.sources || item.output?.sources),
        ingestedAt: new Date().toISOString(),
      };
      const result = await client.query(`UPDATE "MvlOeRecoveryItem"
        SET status = 'RESEARCHED', research_output = $3::jsonb, last_error = NULL, updated_at = now()
        WHERE job_id = $1 AND canonical_part_id = $2 AND status IN ('PENDING','RETRY','RESEARCHING')`,
        [jobId, partId, JSON.stringify(research)]);
      accepted += result.rowCount;
    }
    await client.query(`UPDATE "MvlOeRecoveryJob" SET status = 'QUEUED', updated_at = now() WHERE id = $1 AND status <> 'COMPLETE'`, [jobId]);
    console.log(JSON.stringify({ event: 'research_ingested', jobId, accepted }));
  } finally { await client.end(); }
}

async function claim(client, jobId, noResearch) {
  await client.query('BEGIN');
  try {
    const claimStatuses = noResearch ? "('RESEARCHED')" : "('PENDING','RETRY','RESEARCHED')";
    const { rows: [item] } = await client.query(`SELECT * FROM "MvlOeRecoveryItem"
      WHERE job_id = $1 AND status IN ${claimStatuses} AND next_attempt_at <= now()
      ORDER BY CASE WHEN status = 'RESEARCHED' THEN 0 ELSE 1 END, id
      FOR UPDATE SKIP LOCKED LIMIT 1`, [jobId]);
    if (!item) { await client.query('COMMIT'); return null; }
    await client.query(`UPDATE "MvlOeRecoveryItem" SET status = 'RESEARCHING', attempts = attempts + 1, claimed_at = now(), updated_at = now() WHERE id = $1`, [item.id]);
    await client.query(`UPDATE "MvlOeRecoveryJob" SET status = 'RUNNING', started_at = COALESCE(started_at, now()), last_heartbeat_at = now(), updated_at = now() WHERE id = $1`, [jobId]);
    await client.query('COMMIT');
    return item;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function saveResearch(client, itemId, research) {
  await client.query(`UPDATE "MvlOeRecoveryItem" SET status = 'RESEARCHED', research_output = $2::jsonb, last_error = NULL, updated_at = now() WHERE id = $1`, [itemId, JSON.stringify(research)]);
}

async function findMvlHits(client, application, sourceUrls) {
  const { rows } = await client.query(`
    SELECT DISTINCT ON (mv."year") mv.id, mv.epid, mv."kType", mv.market, mv."sourceKey", mv.year, mv.make, mv.model,
           mv.trim, mv.engine, mv."driveType" AS "driveType", mv."fuelType" AS "fuelType", mv.body,
           mv."displayName" AS "displayName", mv."normalizedModel" AS "normalizedModel"
    FROM "MvlVehicle" mv
    WHERE mv."normalizedMake" = $1 AND mv."normalizedModel" = $2 AND mv.year BETWEEN $3 AND $4
    ORDER BY mv."year", CASE mv.market WHEN 'DE' THEN 1 WHEN 'UK' THEN 2 WHEN 'AU' THEN 3 WHEN 'US' THEN 4 ELSE 9 END, mv.id`,
    [norm(application.make), norm(application.model), application.from, application.to]);
  return rows.map((row) => ({ ...row, sourceUrl: sourceUrls[0] || null, sourceUrls }));
}

async function upsertHit(client, partId, hit) {
  await client.query(`INSERT INTO "VehicleMake" (id, name, "canonicalName", "displayName") VALUES (gen_random_uuid(), $1, $1, $1) ON CONFLICT (name) DO NOTHING`, [hit.make]);
  const { rows: [make] } = await client.query(`SELECT id FROM "VehicleMake" WHERE name = $1 LIMIT 1`, [hit.make]);
  let { rows: [model] } = await client.query(`SELECT id FROM "VehicleModel" WHERE "makeId" = $1 AND name = $2 ORDER BY id LIMIT 1`, [make.id, hit.model]);
  if (!model) ({ rows: [model] } = await client.query(`INSERT INTO "VehicleModel" (id, "makeId", name) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [make.id, hit.model]));
  let { rows: [generation] } = await client.query(`SELECT id FROM "VehicleGeneration" WHERE "modelId" = $1 AND COALESCE("startYear",0) <= $2 AND ("endYear" IS NULL OR "endYear" >= $2) ORDER BY "startYear" DESC NULLS LAST, id LIMIT 1`, [model.id, hit.year]);
  if (!generation) ({ rows: [generation] } = await client.query(`INSERT INTO "VehicleGeneration" (id, "modelId", name, "startYear", "endYear") VALUES (gen_random_uuid(), $1, $2, $3, $3) RETURNING id`, [model.id, `${hit.model} ${hit.year}`, hit.year]));
  let { rows: [configuration] } = await client.query(`SELECT id FROM "VehicleConfiguration" WHERE "generationId" = $1 AND market IS NOT DISTINCT FROM $2 AND trim IS NOT DISTINCT FROM $3 AND engine IS NOT DISTINCT FROM $4 ORDER BY id LIMIT 1`, [generation.id, hit.market, hit.trim, hit.engine]);
  if (!configuration) ({ rows: [configuration] } = await client.query(`INSERT INTO "VehicleConfiguration" (id, "generationId", trim, engine, drivetrain, fuel, market, epid) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (epid) DO NOTHING RETURNING id`, [generation.id, hit.trim, hit.engine, hit.driveType, hit.fuelType, hit.market, hit.epid]));
  if (!configuration && hit.epid) ({ rows: [configuration] } = await client.query(`SELECT id FROM "VehicleConfiguration" WHERE epid = $1`, [hit.epid]));
  if (!configuration) throw new Error(`could not create vehicle configuration for ${hit.make} ${hit.model} ${hit.year}`);
  const { rows: [fitment] } = await client.query(`INSERT INTO "Fitment" (id, "canonicalPartId", "vehicleConfigId", "evidenceLevel", confidence, reviewer, source, "verificationStatus", reason, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), $1, $2, 'B', 0.9, 'Auto (You.com OE parameters + direct MVL)', 'MVL_BACKFILL', 'VERIFIED', 'Matched MVL using You.com OE-derived vehicle parameters', now(), now())
    ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO UPDATE SET "evidenceLevel"='B', confidence=0.9, reviewer='Auto (You.com OE parameters + direct MVL)', source='MVL_BACKFILL', "verificationStatus"='VERIFIED', reason='Matched MVL using You.com OE-derived vehicle parameters', "updatedAt"=now()
    RETURNING id`, [partId, configuration.id]);
  await client.query(`INSERT INTO "FitmentEvidence" (id, "fitmentId", "evidenceType", "evidenceLevel", confidence, source, "sourceRecordId", "originalValue", "normalizedValue", reason, "verifiedBy", "verifiedAt", "createdAt")
    SELECT gen_random_uuid(), $1, 'MVL_MATCH', 'B', 0.9, 'MVL_BACKFILL', $2, $3::jsonb, $4::jsonb, 'Matched MVL using You.com OE-derived vehicle parameters', 'Auto (You.com OE parameters + direct MVL)', now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM "FitmentEvidence" WHERE "fitmentId" = $1 AND "evidenceType" = 'MVL_MATCH' AND source = 'MVL_BACKFILL')`,
    [fitment.id, hit.id, JSON.stringify({ parameterSource: 'you.com', parameterUrl: hit.sourceUrl, sourceUrls: hit.sourceUrls, oeNumber: hit.oeNumber, mvlId: hit.id, market: hit.market, sourceKey: hit.sourceKey }), JSON.stringify({ year: hit.year, make: hit.make, model: hit.model, trim: hit.trim, engine: hit.engine, driveType: hit.driveType, fuelType: hit.fuelType, body: hit.body })]);
}

async function applyResearch(client, item, research) {
  const applications = applicationsFromResearch(research);
  const urls = sourceUrls(research);
  if (!applications.length || !urls.length) return { status: 'SKIPPED', reason: 'No bounded applications or source URLs', rows: 0 };
  const hits = [];
  for (const application of applications.slice(0, 24)) {
    const appHits = await findMvlHits(client, application, urls);
    hits.push(...appHits.map((hit) => ({ ...hit, oeNumber: primaryOeNumber(item), application })));
  }
  const unique = [...new Map(hits.map((hit) => [`${hit.make}|${hit.model}|${hit.year}`, hit])).values()];
  if (!unique.length) return { status: 'SKIPPED', reason: 'No exact MvlVehicle make/model/year matches', rows: 0 };
  await client.query('BEGIN');
  try {
    for (const hit of unique) await upsertHit(client, item.canonical_part_id, hit);
    const compatibility = unique.map((hit) => ({ year: hit.year, make: hit.make, model: hit.model, trim: hit.trim || '-', engine: hit.engine || '-', source: 'mvl', verified: true, parameterSource: 'you.com', parameterUrl: hit.sourceUrl, sourceUrls: hit.sourceUrls, oeNumber: primaryOeNumber(item) }));
    await client.query(`UPDATE "CanonicalPart" cp SET compatibility = (
      SELECT jsonb_agg(value) FROM (SELECT DISTINCT value FROM jsonb_array_elements(
        (CASE WHEN jsonb_typeof(COALESCE(cp.compatibility, '[]'::jsonb)) = 'array' THEN cp.compatibility ELSE '[]'::jsonb END) || $2::jsonb
      )) distinct_rows(value)
    ), "fitmentStatus"='CONFIRMED', "fitmentConfidence"=0.9,
      "fitmentFlags"=ARRAY(SELECT DISTINCT flag FROM unnest(COALESCE(cp."fitmentFlags", ARRAY[]::text[]) || ARRAY['MVL_VERIFIED']::text[]) AS u(flag)), "updatedAt"=now()
      WHERE cp.id=$1 AND EXISTS (SELECT 1 FROM "SellerOffer" so WHERE so."canonicalPartId"=cp.id AND so."sellerId"=$3 AND so.status='ACTIVE')`, [item.canonical_part_id, JSON.stringify(compatibility), SELLER_ID]);
    await client.query(`UPDATE "MvlOeRecoveryItem" SET status='ATTACHED', mvl_rows=$2, last_error=NULL, updated_at=now() WHERE id=$1`, [item.id, unique.length]);
    await client.query('COMMIT');
    return { status: 'ATTACHED', reason: null, rows: unique.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function finishItem(client, item, outcome, research) {
  if (outcome.status === 'ATTACHED') return;
  const terminal = outcome.status === 'SKIPPED' || item.attempts >= MAX_ATTEMPTS;
  await client.query(`UPDATE "MvlOeRecoveryItem" SET status=$2, last_error=$3, research_output=COALESCE(research_output,$4::jsonb), next_attempt_at=now(), updated_at=now() WHERE id=$1`, [item.id, terminal ? outcome.status : 'RETRY', outcome.reason || null, research ? JSON.stringify(research) : null]);
}

async function worker(jobId, workerIndex, noResearch) {
  const client = await connect();
  try {
    while (true) {
      const item = await claim(client, jobId, noResearch);
      if (!item) return;
      try {
        let research = item.research_output;
        if (!research && !noResearch) {
          research = await callYouResearch(item);
          await saveResearch(client, item.id, research);
        }
        if (!research) {
          await finishItem(client, item, { status: 'RETRY', reason: 'Research input unavailable' }, null);
          return;
        }
        const outcome = await applyResearch(client, item, research);
        await finishItem(client, item, outcome, research);
        await client.query(`UPDATE "MvlOeRecoveryJob" SET last_heartbeat_at=now(), updated_at=now() WHERE id=$1`, [jobId]);
        console.log(JSON.stringify({ event: 'item', jobId, worker: workerIndex, itemId: item.id, partId: item.canonical_part_id, status: outcome.status, rows: outcome.rows || 0, reason: outcome.reason || null }));
      } catch (error) {
        await finishItem(client, item, { status: 'FAILED', reason: error?.message || String(error) }, null);
        console.error(JSON.stringify({ event: 'item_error', jobId, worker: workerIndex, itemId: item.id, error: error?.message || String(error) }));
      }
    }
  } finally { await client.end(); }
}

async function run(jobId, noResearch) {
  const client = await connect();
  try { await ensureSchema(client); } finally { await client.end(); }
  if (!noResearch && !YDC_API_KEY) {
    await status(jobId);
    console.error('WAITING_FOR_YDC_KEY: configure YDC_API_KEY or ingest a You.com feed, then run with --no-research');
    process.exitCode = 3;
    return;
  }
  const workers = Math.max(1, Math.min(Number(valueOf('--workers', DEFAULT_WORKERS)), 16));
  const baseline = await connect();
  try {
    await baseline.query(`UPDATE "MvlOeRecoveryJob"
      SET status='RUNNING', started_at=now(), last_heartbeat_at=now(), updated_at=now()
      WHERE id=$1`, [jobId]);
  } finally { await baseline.end(); }
  await Promise.all(Array.from({ length: workers }, (_, index) => worker(jobId, index, noResearch)));
  const final = await connect();
  try {
    const { rows: [remaining] } = await final.query(`SELECT count(*)::int AS count FROM "MvlOeRecoveryItem" WHERE job_id=$1 AND status IN ('PENDING','RETRY','RESEARCHING','RESEARCHED')`, [jobId]);
    if (remaining.count === 0) await final.query(`UPDATE "MvlOeRecoveryJob" SET status='COMPLETE', completed_at=now(), last_heartbeat_at=now(), updated_at=now() WHERE id=$1`, [jobId]);
    else await final.query(`UPDATE "MvlOeRecoveryJob" SET status='QUEUED', last_heartbeat_at=now(), updated_at=now() WHERE id=$1`, [jobId]);
  } finally { await final.end(); }
  await status(jobId);
}

async function main() {
  if (has('--init')) { await initJob(); return; }
  const jobId = valueOf('--job-id') || valueOf('--status') || valueOf('--export') || valueOf('--ingest');
  if (!jobId) throw new Error('Use --init, --run --job-id JOB_ID, --status JOB_ID, --export JOB_ID, or --ingest JOB_ID --file FILE');
  if (has('--status')) { await status(jobId); return; }
  if (has('--export')) { await exportPending(jobId, Number(valueOf('--limit', 100))); return; }
  if (has('--ingest')) { const file = valueOf('--file'); if (!file) throw new Error('--file is required with --ingest'); await ingest(jobId, file); return; }
  if (has('--run')) { await run(jobId, has('--no-research')); return; }
  throw new Error('No operation selected');
}

main().catch((error) => { console.error(error?.stack || error?.message || error); process.exitCode = 1; });
