#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';

const PAYLOAD_PATH = process.env.FEBI_PARTSFINDER_PAYLOAD || '/tmp/febi-partsfinder-applications.jsonl';
const BACKUP_PATH = process.env.FEBI_PARTSFINDER_BACKUP || `/tmp/febi-partsfinder-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
const APPLY = process.argv.includes('--apply');
const SELLER_ID = 'seller-superior-auto-parts';
const normalize = (value) => String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseModelYears(modelTitle) {
  const value = String(modelTitle ?? '').trim();
  const match = value.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\s*$/);
  if (match) return { yearFrom: Number(match[1]), yearTo: Number(match[2]) };
  const single = value.match(/\b((?:19|20)\d{2})\s*$/);
  return single ? { yearFrom: Number(single[1]), yearTo: Number(single[1]) } : { yearFrom: null, yearTo: null };
}

function modelName(modelTitle) {
  const value = String(modelTitle ?? '').replace(/\s+((?:19|20)\d{2})(?:\s*[-–]\s*(?:19|20)\d{2})?\s*$/, '').trim();
  return value || '-';
}

function makeOfficialRow(application, limitations, sourceUrl) {
  const attrs = application?.attributes || {};
  const span = parseModelYears(attrs.modelTitle);
  const limitationValues = limitations.map((item) => item?.attributes?.value).filter(Boolean);
  const notes = [
    attrs.variantTitle ? `Variant: ${attrs.variantTitle}` : '',
    attrs.engineCapacity ? `Capacity: ${attrs.engineCapacity} cc` : '',
    attrs.csvFuelTypes ? `Fuel: ${attrs.csvFuelTypes}` : '',
    attrs.body ? `Body: ${attrs.body}` : '',
    attrs.modelCodes ? `Model code: ${attrs.modelCodes}` : '',
    limitationValues.length ? `Limitations: ${limitationValues.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  return {
    year: span.yearFrom ?? '-',
    yearFrom: span.yearFrom,
    yearTo: span.yearTo,
    make: attrs.makeTitle || '-',
    model: modelName(attrs.modelTitle),
    modelTitle: attrs.modelTitle || null,
    trim: attrs.variantTitle || '-',
    engine: attrs.engine || '-',
    engineCapacity: attrs.engineCapacity || null,
    fuel: attrs.csvFuelTypes || null,
    body: attrs.body || null,
    modelCodes: attrs.modelCodes || null,
    variantId: attrs.variantId ?? null,
    applicationId: application?.id || null,
    notes,
    source: 'PARTSFINDER_USED_IN_VEHICLES',
    sourceUrl,
    official: true,
    mvlVerified: false,
  };
}

const aggregate = new Map();
let inputRows = 0;
let successfulRows = 0;
let officialApplications = 0;
const input = readline.createInterface({ input: fs.createReadStream(PAYLOAD_PATH), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  inputRows++;
  const record = JSON.parse(line);
  if (record.brand !== 'FEBI' || record.status !== 'ok' || !Array.isArray(record.applications) || record.applications.length === 0) continue;
  successfulRows++;
  const limitationsByApplication = new Map();
  for (const response of record.applicationResponses || []) {
    if (!response?.ok || !response.body?.data) continue;
    const applicationId = String(response.body.data.id ?? '');
    if (applicationId) limitationsByApplication.set(applicationId, (response.body.included || []).filter((item) => item?.type === 'limitations'));
  }
  const rows = record.applications.map((application) => makeOfficialRow(application, limitationsByApplication.get(String(application.id)) || [], record.sourceUrl));
  officialApplications += rows.length;
  for (const canonicalPartId of record.canonicalPartIds || []) {
    if (!aggregate.has(canonicalPartId)) aggregate.set(canonicalPartId, { sourceUrl: record.sourceUrl, mpn: record.mpn, rows: [] });
    const target = aggregate.get(canonicalPartId);
    const seen = new Set(target.rows.map((row) => `${row.applicationId}|${row.variantId}|${row.make}|${row.model}|${row.trim}`));
    for (const row of rows) {
      const key = `${row.applicationId}|${row.variantId}|${row.make}|${row.model}|${row.trim}`;
      if (!seen.has(key)) { seen.add(key); target.rows.push(row); }
    }
  }
}

if (!aggregate.size) throw new Error('No successful official FEBI application records found');
const db = new PgClient({ connectionString: process.env.DATABASE_URL });
await db.connect();
const ids = [...aggregate.keys()];
const existing = new Map((await db.query(`SELECT id, brand, "manufacturerPartNumber", compatibility, "fitmentFlags", "fitmentStatus", "fitmentConfidence", "itemSpecifics", "updatedAt" FROM "CanonicalPart" WHERE id=ANY($1::text[])`, [ids])).rows.map((row) => [row.id, row]));
const active = new Set((await db.query(`SELECT DISTINCT so."canonicalPartId" FROM "SellerOffer" so WHERE so."sellerId"=$1 AND so.status='ACTIVE' AND so."canonicalPartId"=ANY($2::text[])`, [SELLER_ID, ids])).rows.map((row) => row.canonicalPartId));
const backup = fs.createWriteStream(BACKUP_PATH, { encoding: 'utf8' });
for (const id of ids) {
  const row = existing.get(id);
  if (row) backup.write(JSON.stringify({ id, ...row }) + '\n');
}
await new Promise((resolve, reject) => { backup.end(resolve); backup.on('error', reject); });
const missing = ids.filter((id) => !existing.has(id));
const invalidBrand = ids.filter((id) => String(existing.get(id)?.brand || '').trim().toUpperCase() !== 'FEBI');
const inactive = ids.filter((id) => !active.has(id));
console.log(JSON.stringify({ event: 'validation', mode: APPLY ? 'APPLY' : 'DRY_RUN', inputRows, successfulRows, officialApplications, canonicalParts: ids.length, existingParts: existing.size, activeParts: active.size, missing: missing.length, invalidBrand: invalidBrand.length, inactive: inactive.length, backupPath: BACKUP_PATH }));
if (missing.length || invalidBrand.length) throw new Error(`Validation failed: missing=${missing.length} invalidBrand=${invalidBrand.length}`);
if (!APPLY) { await db.end(); process.exit(0); }

await db.query('BEGIN');
try {
  let processed = 0;
  for (const [id, data] of aggregate) {
    const current = existing.get(id);
    const flags = [...new Set([...(Array.isArray(current.fitmentFlags) ? current.fitmentFlags : []), 'PARTSFINDER_OFFICIAL'])];
    const hasMvl = flags.includes('MVL_VERIFIED');
    const mergedSpecifics = (current.itemSpecifics && typeof current.itemSpecifics === 'object' && !Array.isArray(current.itemSpecifics)) ? { ...current.itemSpecifics } : {};
    mergedSpecifics._febiOfficial = { ...(mergedSpecifics._febiOfficial || {}), source: 'partsfinder.bilsteingroup.com', sourceUrl: data.sourceUrl, articleNumber: data.mpn, applicationRows: data.rows.length, capturedAt: new Date().toISOString() };
    await db.query(`UPDATE "CanonicalPart" SET compatibility=$2::jsonb, "fitmentFlags"=$3::text[], "fitmentStatus"=$4, "fitmentConfidence"=GREATEST(COALESCE("fitmentConfidence",0),0.98), "itemSpecifics"=$5::jsonb, "updatedAt"=now() WHERE id=$1`, [id, JSON.stringify(data.rows), flags, hasMvl ? 'CONFIRMED' : 'OFFICIAL_SOURCE', JSON.stringify(mergedSpecifics)]);
    await db.query(`INSERT INTO "SearchOutbox" (id,"entityType","entityId",operation,status,"availableAt","createdAt","updatedAt") SELECT $1,'CanonicalPart',$2,'UPSERT','PENDING',now(),now(),now() WHERE NOT EXISTS (SELECT 1 FROM "SearchOutbox" WHERE "entityType"='CanonicalPart' AND "entityId"=$2 AND operation='UPSERT' AND status='PENDING')`, [crypto.randomUUID(), id]);
    processed++;
    if (processed % 100 === 0) console.log(JSON.stringify({ event: 'db_progress', processed, total: ids.length, officialRows: data.rows.length }));
  }
  await db.query('COMMIT');
  console.log(JSON.stringify({ event: 'db_applied', processed, total: ids.length, backupPath: BACKUP_PATH }));
} catch (error) {
  await db.query('ROLLBACK');
  console.error(JSON.stringify({ event: 'db_rollback', error: error?.message || String(error), backupPath: BACKUP_PATH }));
  await db.end();
  process.exit(1);
}
await db.end();
