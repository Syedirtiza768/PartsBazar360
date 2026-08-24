#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';

const PAYLOAD_PATH = process.env.LEMFORDER_GAP_REFRESH_PAYLOAD || '/tmp/lemforder-fcpeuro-luna-enrichment-batch-gap-refresh-2026-08-15.jsonl';
const APPLY = process.argv.includes('--apply');
const REPORT_PATH = process.env.LEMFORDER_GAP_REFRESH_REPORT || '/tmp/lemforder-gap-refresh-report.json';
const BACKUP_PATH = process.env.LEMFORDER_GAP_REFRESH_BACKUP || '/tmp/lemforder-gap-refresh-backup.json';
const SELLER_ID = 'seller-superior-auto-parts';
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];

function makeFromTitle(title) {
  const value = text(title).toUpperCase();
  if (/\bMERCEDES(?:-|\s)?BENZ\b/.test(value)) return 'MERCEDESBENZ';
  if (/\bVOLKSWAGEN\b|\bVW\b/.test(value)) return 'VOLKSWAGEN';
  if (/\bBMW\b/.test(value)) return 'BMW';
  if (/\bPORSCHE\b/.test(value)) return 'PORSCHE';
  if (/\bMINI\b/.test(value)) return 'MINI';
  if (/\bAUDI\b/.test(value)) return 'AUDI';
  if (/\bVOLVO\b/.test(value)) return 'VOLVO';
  if (/\bFORD\b/.test(value)) return 'FORD';
  if (/\bTOYOTA\b/.test(value)) return 'TOYOTA';
  if (/\bHONDA\b/.test(value)) return 'HONDA';
  if (/\bNISSAN\b/.test(value)) return 'NISSAN';
  if (/\bJAGUAR\b/.test(value)) return 'JAGUAR';
  if (/\bLAND\s*ROVER\b/.test(value)) return 'LANDROVER';
  return '';
}

function directCompatibility(row) {
  const make = makeFromTitle(row.title);
  const vehicleText = text(row.vehicleTitle);
  if (!make || !vehicleText || /^(&|and|more|\W)+$/i.test(vehicleText)) return [];
  const models = unique(vehicleText.split(/[,.&;+]+/).map((value) => value.replace(/\b(and|more)\b/ig, '').trim()).filter((value) => value.length >= 2));
  return models.map((model) => ({
    id: 'fcpeuro-product-title-' + normalize(make) + '-' + normalize(model),
    year: null,
    yearStart: null,
    yearEnd: null,
    make,
    model,
    trim: '-',
    engine: '-',
    market: null,
    source: 'FCPEURO_PRODUCT_TITLE',
    verificationStatus: 'CONFIRMED',
    sourceUrl: row.selectedProductUrl || row.searchUrl || null,
    notes: 'Trusted FCPEuro product title/application line: ' + vehicleText,
  }));
}

const rows = fs.readFileSync(PAYLOAD_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const byMpn = new Map(rows.map((row) => [normalize(row.mpn), row]));
const client = new PgClient({ connectionString: process.env.DATABASE_URL });
await client.connect();
const mpns = [...byMpn.keys()];
const result = await client.query("SELECT id, \"manufacturerPartNumber\", title, compatibility, \"fitmentFlags\", \"fitmentStatus\", \"fitmentConfidence\" FROM \"CanonicalPart\" WHERE upper(trim(brand))=$1 AND regexp_replace(upper(\"manufacturerPartNumber\"), '[^A-Z0-9]', '', 'g')=ANY($2::text[]) AND EXISTS (SELECT 1 FROM \"SellerOffer\" WHERE \"canonicalPartId\"=\"CanonicalPart\".id AND \"sellerId\"=$3 AND status='ACTIVE')", ['LEMFORDER', mpns, SELLER_ID]);
const current = new Map(result.rows.map((row) => [normalize(row.manufacturerPartNumber), row]));
const updates = [];
for (const [mpn, part] of current) {
  const row = byMpn.get(mpn);
  if (!row) continue;
  const sourceRows = directCompatibility(row);
  const baseTitle = text(row.title).replace(/\s*\|\s*Fitment not confirmed\s*$/i, '').replace(/\s*\|\s*Fitment not available\s*$/i, '').trim();
  const refreshedTitle = text(row.title).replace(/\s*\|\s*Fitment not confirmed\s*$/i, '').replace(/\s*\|\s*Fitment not available\s*$/i, '').trim();
  const pageTitle = text(row.title);
  const sourceTitle = text(row.title);
  const fetchedTitle = text(row.title);
  const rawSourceTitle = text(row.title);
  const resultTitle = text(row.title);
  const payloadTitle = text(row.title);
  const fetched = text(row.title);
  const refreshTitle = text(row.title);
  const source = byMpn.get(mpn);
  const actualTitle = text(source.title);
  const nextTitle = actualTitle ? 'LEMFORDER | ' + actualTitle + (sourceRows.length && text(source.vehicleTitle) ? ' | Fits ' + text(source.vehicleTitle) : '') : baseTitle;
  const currentCompatibility = Array.isArray(part.compatibility) ? part.compatibility : [];
  const flags = Array.isArray(part.fitmentFlags) ? part.fitmentFlags.filter((flag) => flag !== 'Vehicle compatibility could not be inferred') : [];
  if (sourceRows.length) flags.push('FCPEURO_TRUSTED_SOURCE');
  const nextCompatibility = sourceRows.length ? sourceRows : currentCompatibility;
  const nextStatus = sourceRows.length ? 'CONFIRMED' : part.fitmentStatus;
  const nextConfidence = sourceRows.length ? 0.9 : part.fitmentConfidence;
  if (nextTitle !== part.title || sourceRows.length > 0) updates.push({ row: source, part, nextTitle, nextCompatibility, nextStatus, nextConfidence, flags: [...new Set(flags)], sourceRows });
}
const report = {
  createdAt: new Date().toISOString(),
  mode: APPLY ? 'APPLY' : 'DRY_RUN',
  inputRows: rows.length,
  matchedParts: current.size,
  updatedParts: updates.length,
  fitmentParts: updates.filter((row) => row.sourceRows.length > 0).length,
  fitmentRows: updates.reduce((sum, row) => sum + row.sourceRows.length, 0),
  titleOnlyParts: updates.filter((row) => row.sourceRows.length === 0).length,
  noFetchedTitleOrFitment: rows.filter((row) => !text(row.title) && !directCompatibility(row).length).length,
  parts: updates.map((row) => ({ mpn: row.part.manufacturerPartNumber, title: row.nextTitle, sourceUrl: row.row.selectedProductUrl || row.row.searchUrl || null, fitmentRows: row.sourceRows })),
};
fs.writeFileSync(REPORT_PATH, JSON.stringify(report), 'utf8');
console.log(JSON.stringify({ event: 'lemforder_gap_refresh_summary', ...report, reportPath: REPORT_PATH }));
if (!APPLY) {
  await client.end();
  process.exit(0);
}
fs.writeFileSync(BACKUP_PATH, JSON.stringify({ createdAt: new Date().toISOString(), parts: updates.map((row) => row.part) }), 'utf8');
await client.query('BEGIN');
try {
  for (const row of updates) {
    await client.query('UPDATE "CanonicalPart" SET title=$2, compatibility=$3::jsonb, "fitmentFlags"=$4::text[], "fitmentStatus"=$5, "fitmentConfidence"=$6, "updatedAt"=now() WHERE id=$1', [row.part.id, row.nextTitle, JSON.stringify(row.nextCompatibility), row.flags, row.nextStatus, row.nextConfidence]);
    await client.query("INSERT INTO \"SearchOutbox\" (id, \"entityType\", \"entityId\", operation, status, \"availableAt\", \"createdAt\", \"updatedAt\") SELECT $1,'CanonicalPart',$2,'UPSERT','PENDING',now(),now(),now() WHERE NOT EXISTS (SELECT 1 FROM \"SearchOutbox\" WHERE \"entityType\"='CanonicalPart' AND \"entityId\"=$2 AND operation='UPSERT' AND status='PENDING')", [crypto.randomUUID(), row.part.id]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'lemforder_gap_refresh_applied', updatedParts: updates.length, fitmentParts: report.fitmentParts, fitmentRows: report.fitmentRows, titleOnlyParts: report.titleOnlyParts, backupPath: BACKUP_PATH, reportPath: REPORT_PATH }));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(JSON.stringify({ event: 'lemforder_gap_refresh_rollback', error: error?.message || String(error), backupPath: BACKUP_PATH }));
  process.exitCode = 1;
}
await client.end();