#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const PAYLOAD_PATH = process.env.FEBI_PAYLOAD || '/tmp/febi-production-replacement.jsonl';
const BACKUP_PATH = process.env.FEBI_BACKUP || `/tmp/febi-replacement-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const APPLY = process.argv.includes('--apply');
const SELLER_ID = 'seller-superior-auto-parts';
const INDEX = process.env.OPENSEARCH_INDEX || 'canonical_parts';
const OS_URL = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const cleanUrl = (value) => { try { const u = new URL(String(value)); u.hash = ''; return u.toString(); } catch { return String(value ?? '').trim(); } };
const readPayload = () => fs.readFileSync(PAYLOAD_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const payload = readPayload();
const canonicalMap = new Map();
const listingMap = new Map();
for (const row of payload) {
  if (row.brand !== 'FEBI') throw new Error(`Non-FEBI payload row: ${row.listingId}`);
  if (canonicalMap.has(row.canonicalPartId) && canonicalMap.get(row.canonicalPartId).manufacturerPartNumber !== row.manufacturerPartNumber) throw new Error(`Conflicting payload canonical part: ${row.canonicalPartId}`);
  canonicalMap.set(row.canonicalPartId, row);
  if (listingMap.has(row.listingId)) throw new Error(`Duplicate payload listing: ${row.listingId}`);
  listingMap.set(row.listingId, row);
}
if (!payload.length) throw new Error('Empty FEBI payload');

const client = new PgClient({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ids = [...canonicalMap.keys()];
const listingIds = [...listingMap.keys()];
const existingResult = await client.query(`SELECT id, brand, manufacturer, "manufacturerPartNumber", title, description, "oeNumbers", "imageUrls", "itemSpecifics", compatibility, "fitmentFlags", "fitmentStatus", "fitmentConfidence", "enrichmentStatus", "enrichmentVersion", "enrichmentSource", "enrichedAt", "updatedAt" FROM "CanonicalPart" WHERE id = ANY($1::text[])`, [ids]);
const existing = new Map(existingResult.rows.map((row) => [row.id, row]));
const offerResult = await client.query(`SELECT id, "canonicalPartId", "sellerId", status, price, currency, condition, "partSource", "qualityTier", "sellerSku", "sellerTitle", "partType", "sourceTag", "updatedAt" FROM "SellerOffer" WHERE "sellerId"=$1 AND (id = ANY($2::text[]) OR "canonicalPartId" = ANY($3::text[]))`, [SELLER_ID, listingIds, ids]);
const offers = offerResult.rows;
const activeByListing = new Map(offers.filter((row) => row.status === 'ACTIVE').map((row) => [row.id, row]));
const activeByPart = new Map();
for (const offer of offers.filter((row) => row.status === 'ACTIVE')) { if (!activeByPart.has(offer.canonicalPartId)) activeByPart.set(offer.canonicalPartId, []); activeByPart.get(offer.canonicalPartId).push(offer); }
const missingParts = ids.filter((id) => !existing.has(id));
const invalidBrand = [...existing.values()].filter((row) => String(row.brand || '').trim().toUpperCase() !== 'FEBI');
const mpnMismatch = payload.filter((row) => { const current = existing.get(row.canonicalPartId); return current && normalize(current.manufacturerPartNumber) !== normalize(row.manufacturerPartNumber); });
const missingActiveOffers = payload.filter((row) => !activeByListing.has(row.listingId));
const obsoleteResult = await client.query(`SELECT so.id, so."canonicalPartId", so.status, so.price, so.currency, so.condition, so."partSource", so."qualityTier", so."sellerSku", so."sellerTitle", so."partType", so."sourceTag", so."updatedAt" FROM "SellerOffer" so JOIN "CanonicalPart" cp ON cp.id=so."canonicalPartId" WHERE so."sellerId"=$1 AND so.status='ACTIVE' AND upper(trim(cp.brand))='FEBI' AND NOT (so.id = ANY($2::text[]))`, [SELLER_ID, listingIds]);
const obsolete = obsoleteResult.rows;
const mediaResult = await client.query(`SELECT id, "canonicalPartId", url, "normalizedUrl", "sourceUrl", "sortOrder", "isPrimary", "isActualItem", "mediaType", "importStatus", "altText", "createdAt" FROM "ProductMedia" WHERE "canonicalPartId" = ANY($1::text[])`, [ids]);
const backup = {
  createdAt: new Date().toISOString(),
  payloadPath: PAYLOAD_PATH,
  payloadRows: payload.length,
  canonicalParts: [...existing.values()],
  sellerOffers: offers,
  obsoleteOffers: obsolete,
  productMedia: mediaResult.rows,
};
fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup), 'utf8');
const validation = { payloadRows: payload.length, canonicalParts: canonicalMap.size, existingParts: existing.size, activeOffers: offers.filter((row) => row.status === 'ACTIVE').length, obsoleteOffers: obsolete.length, missingParts: missingParts.length, invalidBrand: invalidBrand.length, mpnMismatch: mpnMismatch.length, missingActiveOffers: missingActiveOffers.length, backupPath: BACKUP_PATH, mode: APPLY ? 'APPLY' : 'DRY_RUN' };
console.log(JSON.stringify({ event: 'validation', ...validation }));
if (missingParts.length || invalidBrand.length || mpnMismatch.length || missingActiveOffers.length) {
  console.error(JSON.stringify({ event: 'validation_failed', missingParts: missingParts.slice(0, 5), invalidBrand: invalidBrand.map((x) => x.id).slice(0, 5), mpnMismatch: mpnMismatch.slice(0, 5).map((x) => x.canonicalPartId), missingActiveOffers: missingActiveOffers.slice(0, 5).map((x) => x.listingId) }));
  await client.end(); process.exit(2);
}
if (!APPLY) { await client.end(); process.exit(0); }

await client.query('BEGIN');
try {
  let partIndex = 0;
  for (const [partId, row] of canonicalMap) {
    const current = existing.get(partId);
    const mergedSpecifics = { ...(current.itemSpecifics && typeof current.itemSpecifics === 'object' ? current.itemSpecifics : {}), ...(row.itemSpecifics || {}), _febiOfficial: { sourceUrl: row.officialSourceUrl, articleNumber: row.officialArticleNumber, model: 'openai/gpt-5.6-luna', checkedAt: new Date().toISOString() } };
    await client.query(`UPDATE "CanonicalPart" SET title=$2, description=$3, "manufacturer"='FEBI', "manufacturerPartNumber"=$4, "oeNumbers"=$5::text[], "imageUrls"=$6::text[], "itemSpecifics"=$7::jsonb, "partSource"='AFTERMARKET', "qualityTier"='NEW', "partType"='AFTERMARKET', "enrichmentStatus"='DONE', "enrichmentVersion"=COALESCE("enrichmentVersion",0)+1, "enrichmentSource"='openrouter:gpt-5.6-luna:partsfinder-url', "enrichedAt"=now(), "updatedAt"=now() WHERE id=$1`, [partId, row.title, row.description || null, row.manufacturerPartNumber, row.oeNumbers || [], row.imageUrls || [], JSON.stringify(mergedSpecifics)]);
    await client.query(`UPDATE "SellerOffer" SET "sellerTitle"=$2, "sellerSku"=$3, "partSource"='AFTERMARKET', "qualityTier"='NEW', "partType"='AFTERMARKET', "updatedAt"=now() WHERE "sellerId"=$4 AND "canonicalPartId"=$1 AND status='ACTIVE'`, [partId, row.title, row.manufacturerPartNumber, SELLER_ID]);
    await client.query(`UPDATE "ProductMedia" SET "isPrimary"=false, "sortOrder"=100 WHERE "canonicalPartId"=$1`, [partId]);
    for (let i = 0; i < (row.imageUrls || []).length; i++) {
      const url = cleanUrl(row.imageUrls[i]); if (!url) continue;
      await client.query(`INSERT INTO "ProductMedia" (id, "canonicalPartId", url, "normalizedUrl", "sourceUrl", "sortOrder", "isPrimary", "isActualItem", "mediaType", "importStatus", "altText") VALUES ($1,$2,$3,$3,$4,$5,$6,false,'IMAGE','IMPORTED',$7) ON CONFLICT ("canonicalPartId","normalizedUrl") DO UPDATE SET url=EXCLUDED.url, "sourceUrl"=EXCLUDED."sourceUrl", "sortOrder"=EXCLUDED."sortOrder", "isPrimary"=EXCLUDED."isPrimary", "importStatus"='IMPORTED', "altText"=EXCLUDED."altText"`, [crypto.randomUUID(), partId, url, row.officialSourceUrl || null, i, i === 0, `FEBI ${row.manufacturerPartNumber} official product image`]);
    }
    partIndex++;
    if (partIndex % 100 === 0) console.log(JSON.stringify({ event: 'db_progress', parts: partIndex, total: canonicalMap.size }));
  }
  if (obsolete.length) await client.query(`UPDATE "SellerOffer" SET status='INACTIVE', "updatedAt"=now() WHERE id = ANY($1::text[]) AND "sellerId"=$2 AND status='ACTIVE'`, [obsolete.map((row) => row.id), SELLER_ID]);
  const changedIds = [...new Set([...ids, ...obsolete.map((row) => row.canonicalPartId)])];
  for (const id of changedIds) {
    await client.query(`INSERT INTO "SearchOutbox" (id, "entityType", "entityId", operation, status, "availableAt", "createdAt", "updatedAt") SELECT $1,'CanonicalPart',$2,'UPSERT','PENDING',now(),now(),now() WHERE NOT EXISTS (SELECT 1 FROM "SearchOutbox" WHERE "entityType"='CanonicalPart' AND "entityId"=$2 AND operation='UPSERT' AND status='PENDING')`, [crypto.randomUUID(), id]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'db_applied', partsUpdated: canonicalMap.size, obsoleteOffersDeactivated: obsolete.length, searchOutboxRequested: changedIds.length, backupPath: BACKUP_PATH }));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(JSON.stringify({ event: 'db_rollback', error: error?.message || String(error), backupPath: BACKUP_PATH }));
  await client.end(); process.exit(1);
}

const os = new OpenSearchClient({ node: OS_URL });
const changedIds = [...new Set([...ids, ...obsolete.map((row) => row.canonicalPartId)])];
const changedResult = await client.query(`SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp.category, cp."categoryGroup", cp."partType", cp."oeNumbers", cp."imageUrls", cp."partSource", cp."qualityTier", cp."fitmentStatus", cp."fitmentConfidence", cp.compatibility, array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fitment_ids FROM "CanonicalPart" cp LEFT JOIN "Fitment" f ON f."canonicalPartId"=cp.id WHERE cp.id=ANY($1::text[]) GROUP BY cp.id`, [changedIds]);
const changedParts = changedResult.rows;
const changedOffers = await client.query(`SELECT so.id, so."canonicalPartId", so."sellerId", so.price, so.condition, so."partSource", so."qualityTier", so.currency, so."sourceTag", so.status FROM "SellerOffer" so WHERE so."canonicalPartId"=ANY($1::text[]) AND so."sellerId"=$2 AND so.status='ACTIVE'`, [changedIds, SELLER_ID]);
const offersByPart = new Map(); for (const offer of changedOffers.rows) { if (!offersByPart.has(offer.canonicalPartId)) offersByPart.set(offer.canonicalPartId, []); offersByPart.get(offer.canonicalPartId).push({ qualityTier: offer.qualityTier, condition: offer.condition, partSource: offer.partSource, sellerId: offer.sellerId, price: Number(offer.price), currency: offer.currency, id: offer.id, sourceTag: offer.sourceTag }); }
let osUpdated = 0; let osFailed = 0;
const workerCount = Math.max(1, Math.min(Number(process.env.OS_WORKERS || 8), 16));
let cursor = 0;
async function osWorker() {
  while (true) {
    const index = cursor++; if (index >= changedParts.length) return;
    const part = changedParts[index];
    try {
      await os.update({ index: INDEX, id: part.id, body: { doc: { title: part.title, brand: part.brand, manufacturerPartNumber: part.manufacturerPartNumber, category: part.category, categoryGroup: part.categoryGroup, partType: part.partType, oeNumbers: part.oeNumbers, imageUrls: part.imageUrls, partSource: part.partSource, qualityTier: part.qualityTier, fitmentStatus: part.fitmentStatus, fitmentConfidence: part.fitmentConfidence, compatibility: part.compatibility, fitments: (part.fitment_ids || []).filter(Boolean), offers: offersByPart.get(part.id) || [], hasImage: Array.isArray(part.imageUrls) && part.imageUrls.length > 0 } }, refresh: false });
      osUpdated++;
    } catch (error) { osFailed++; if (osFailed <= 10) console.error(JSON.stringify({ event: 'opensearch_failed', id: part.id, error: error?.message || String(error) })); }
  }
}
await Promise.all(Array.from({ length: workerCount }, () => osWorker()));
console.log(JSON.stringify({ event: 'search_reindexed', attempted: changedParts.length, updated: osUpdated, failed: osFailed, workers: workerCount }));
await client.end();