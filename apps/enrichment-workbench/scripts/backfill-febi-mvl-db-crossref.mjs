#!/usr/bin/env node
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const SELLER_ID = 'seller-superior-auto-parts';
const APPLY = !process.argv.includes('--dry-run');
const OS_INDEX = process.env.OPENSEARCH_INDEX || 'canonical_parts';
const OS_URL = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const normalize = (value) => String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const asArray = (value) => Array.isArray(value) ? value : [];
const yearOf = (row) => Number(row?.year ?? row?.modelYear ?? row?.yearStart ?? row?.fromYear);

const db = new PgClient({ connectionString: process.env.DATABASE_URL });
await db.connect();
const mvlCount = Number((await db.query('SELECT count(*)::int AS n FROM "MvlVehicle"')).rows[0].n);
console.log(JSON.stringify({ event: 'mvl_db_start', mvlRows: mvlCount, mode: APPLY ? 'APPLY' : 'DRY_RUN', scope: 'FEBI active Superior offers only' }));
if (!mvlCount) throw new Error('MvlVehicle is empty');

await db.query(`
  CREATE TEMP TABLE febi_targets AS
  SELECT DISTINCT cp.id, cp.title, cp."manufacturerPartNumber" AS mpn,
    regexp_replace(upper(coalesce(cp."manufacturerPartNumber",'')),'[^A-Z0-9]','','g') AS mpn_key,
    ARRAY(SELECT regexp_replace(upper(x),'[^A-Z0-9]','','g') FROM unnest(coalesce(cp."oeNumbers", ARRAY[]::text[])) x) AS oe_keys
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id AND so."sellerId"=$1 AND so.status='ACTIVE'
  WHERE upper(trim(cp.brand))='FEBI' AND NOT (cp."fitmentFlags" @> ARRAY['MVL_VERIFIED'])
`, [SELLER_ID]);
await db.query('CREATE INDEX febi_targets_mpn_idx ON febi_targets(mpn_key)');
await db.query('CREATE TEMP TABLE febi_target_oe AS SELECT id AS target_id, unnest(oe_keys) AS key FROM febi_targets WHERE cardinality(oe_keys)>0');
await db.query('CREATE INDEX febi_target_oe_key_idx ON febi_target_oe(key)');
const keyRows = (await db.query(`
  SELECT array_agg(DISTINCT key) AS keys
  FROM (
    SELECT mpn_key AS key FROM febi_targets WHERE mpn_key <> ''
    UNION
    SELECT key FROM febi_target_oe WHERE key <> ''
  ) keys
`)).rows[0];
const searchKeys = keyRows?.keys || [];
await db.query(`
  CREATE TEMP TABLE febi_mvl_verified AS
  SELECT v.id, v."manufacturerPartNumber" AS mpn,
         regexp_replace(upper(coalesce(v."manufacturerPartNumber",'')),'[^A-Z0-9]','','g') AS mpn_key,
         v.compatibility
  FROM "CanonicalPart" v
  WHERE v."fitmentFlags" @> ARRAY['MVL_VERIFIED']
    AND regexp_replace(upper(coalesce(v."manufacturerPartNumber",'')),'[^A-Z0-9]','','g') = ANY($1::text[])
    AND v.compatibility IS NOT NULL
    AND v.compatibility::text NOT IN ('null','[]')
`, [searchKeys]);
await db.query('CREATE INDEX febi_mvl_verified_mpn_idx ON febi_mvl_verified(mpn_key)');const candidates = (await db.query(`
  WITH matches AS (
    SELECT t.id AS target_id, t.title, t.mpn, v.id AS donor_id, v.compatibility, 1 AS priority, 'mpn' AS strategy
    FROM febi_targets t JOIN febi_mvl_verified v ON v.mpn_key=t.mpn_key
    UNION ALL
    SELECT t.id, t.title, t.mpn, v.id, v.compatibility, 2, 'oe_to_mpn'
    FROM febi_targets t JOIN febi_target_oe k ON k.target_id=t.id JOIN febi_mvl_verified v ON v.mpn_key=k.key
  )
  SELECT DISTINCT ON (target_id) target_id, title, mpn, donor_id, compatibility, strategy
  FROM matches ORDER BY target_id, priority, donor_id
`)).rows;
console.log(JSON.stringify({ event: 'candidate_scan', candidates: candidates.length }));
if (!APPLY) { await db.end(); process.exit(0); }

let processed = 0; let verified = 0; let skipped = 0; let failed = 0; const changedIds = [];
for (const candidate of candidates) {
  try {
    const donorRows = asArray(candidate.compatibility);
    const verifiedRows = [];
    for (const row of donorRows) {
      const year = yearOf(row);
      const make = String(row?.make || '').trim();
      const model = String(row?.model || '').trim();
      if (!Number.isInteger(year) || year < 1950 || year > 2035 || !make || !model) continue;
      const hits = await db.query(`SELECT make, model, epid, "kType", trim, engine, market FROM "MvlVehicle" WHERE year=$1 AND "normalizedMake"=$2 AND "normalizedModel"=$3 AND market = ANY($4::text[]) LIMIT 1`, [year, normalize(make), normalize(model), ['DE','UK','AU','US']]);
      const hit = hits.rows[0];
      if (!hit) continue;
      verifiedRows.push({ year, make: hit.make, model: hit.model, trim: row.trim || hit.trim || '-', engine: row.engine || hit.engine || '-', source: 'MVL_OE_CROSS_REF', epid: hit.epid, verified: true });
    }
    if (!verifiedRows.length) { skipped++; processed++; continue; }
    const donorFitments = (await db.query('SELECT "vehicleConfigId", "evidenceLevel", confidence FROM "Fitment" WHERE "canonicalPartId"=$1', [candidate.donor_id])).rows;
    await db.query('BEGIN');
    try {
      const fitmentIds = [];
      for (const donorFitment of donorFitments) {
        const id = crypto.randomUUID();
        const inserted = await db.query(`INSERT INTO "Fitment" (id,"canonicalPartId","vehicleConfigId","evidenceLevel",confidence,reviewer,source,"verificationStatus",reason,"createdAt","updatedAt") VALUES ($1,$2,$3,'B',0.9,'Auto (MVL DB OE cross-reference)','MVL_OE_CROSS_REF','VERIFIED','Copied from MVL-verified OE/MPN match',now(),now()) ON CONFLICT ("canonicalPartId","vehicleConfigId") DO UPDATE SET "evidenceLevel"='B',confidence=0.9,reviewer='Auto (MVL DB OE cross-reference)',source='MVL_OE_CROSS_REF',"verificationStatus"='VERIFIED',reason='Copied from MVL-verified OE/MPN match',"updatedAt"=now() RETURNING id`, [id, candidate.target_id, donorFitment.vehicleConfigId]);
        fitmentIds.push(inserted.rows[0].id);
      }
      const flags = ['MVL_VERIFIED','OE_CROSS_REF'];
      await db.query(`UPDATE "CanonicalPart" SET compatibility=$2::jsonb,"fitmentStatus"='CONFIRMED',"fitmentConfidence"=0.9,"fitmentFlags"=ARRAY(SELECT DISTINCT unnest(coalesce("fitmentFlags",ARRAY[]::text[]) || $3::text[])),"updatedAt"=now() WHERE id=$1`, [candidate.target_id, JSON.stringify(verifiedRows), flags]);
      await db.query(`INSERT INTO "SearchOutbox" (id,"entityType","entityId",operation,status,"availableAt","createdAt","updatedAt") SELECT $1,'CanonicalPart',$2,'UPSERT','PENDING',now(),now(),now() WHERE NOT EXISTS (SELECT 1 FROM "SearchOutbox" WHERE "entityType"='CanonicalPart' AND "entityId"=$2 AND operation='UPSERT' AND status='PENDING')`, [crypto.randomUUID(), candidate.target_id]);
      await db.query('COMMIT');
      verified++; changedIds.push(candidate.target_id);
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  } catch (error) { failed++; if (failed <= 10) console.error(JSON.stringify({ event: 'part_fail', id: candidate.target_id, error: error?.message || String(error) })); }
  processed++;
  if (processed % 25 === 0) console.log(JSON.stringify({ event: 'mvl_db_progress', processed, candidates: candidates.length, verified, skipped, failed }));
}
const os = new OpenSearchClient({ node: OS_URL });
let osUpdated = 0; let osFailed = 0;
for (const id of changedIds) {
  try {
    const row = (await db.query(`SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp.category, cp."categoryGroup", cp."partType", cp."oeNumbers", cp."imageUrls", cp."partSource", cp."qualityTier", cp."fitmentStatus", cp."fitmentConfidence", cp.compatibility, array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fitment_ids FROM "CanonicalPart" cp LEFT JOIN "Fitment" f ON f."canonicalPartId"=cp.id WHERE cp.id=$1 GROUP BY cp.id`, [id])).rows[0];
    if (!row) continue;
    await os.update({ index: OS_INDEX, id, body: { doc: { title: row.title, brand: row.brand, manufacturerPartNumber: row.manufacturerPartNumber, category: row.category, categoryGroup: row.categoryGroup, partType: row.partType, oeNumbers: row.oeNumbers, imageUrls: row.imageUrls, partSource: row.partSource, qualityTier: row.qualityTier, fitmentStatus: row.fitmentStatus, fitmentConfidence: row.fitmentConfidence, compatibility: row.compatibility, fitments: (row.fitment_ids || []).filter(Boolean) } }, refresh: false });
    osUpdated++;
  } catch { osFailed++; }
}
console.log(JSON.stringify({ event: 'mvl_db_done', candidates: candidates.length, processed, verified, skipped, failed, searchReindexed: osUpdated, searchFailed: osFailed, mvlRows: mvlCount }));
await db.end();