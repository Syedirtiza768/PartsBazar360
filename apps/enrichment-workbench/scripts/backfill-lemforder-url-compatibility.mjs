#!/usr/bin/env node
import fs from 'node:fs';
import { Client as PgClient } from 'pg';
import crypto from 'node:crypto';

const PAYLOAD_PATH = process.env.LEMFORDER_PAYLOAD || '/tmp/lemforder-production-replacement.jsonl';
const APPLY = process.argv.includes('--apply');
const SELLER_ID = 'seller-superior-auto-parts';
const BRAND = 'LEMFORDER';
const REPORT_PATH = process.env.LEMFORDER_URL_REPORT || `/tmp/lemforder-url-compat-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const unique = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
const makes = new Map([
  ['BMW', ['BMW']], ['AUDI', ['AUDI']], ['PORSCHE', ['PORSCHE']], ['VOLKSWAGEN', ['VOLKSWAGEN', 'VW']], ['VW', ['VOLKSWAGEN', 'VW']],
  ['MERCEDESBENZ', ['MERCEDESBENZ', 'MERCEDES']], ['MERCEDES', ['MERCEDESBENZ', 'MERCEDES']], ['MINI', ['MINI']], ['VOLVO', ['VOLVO']],
  ['JAGUAR', ['JAGUAR']], ['LANDROVER', ['LANDROVER']], ['FORD', ['FORD']], ['TOYOTA', ['TOYOTA']], ['LEXUS', ['LEXUS']],
  ['HONDA', ['HONDA']], ['NISSAN', ['NISSAN']], ['INFINITI', ['INFINITI']], ['SUBARU', ['SUBARU']], ['MAZDA', ['MAZDA']],
  ['MITSUBISHI', ['MITSUBISHI']], ['HYUNDAI', ['HYUNDAI']], ['KIA', ['KIA']], ['RENAULT', ['RENAULT']], ['PEUGEOT', ['PEUGEOT']],
  ['FIAT', ['FIAT']], ['SAAB', ['SAAB']], ['SMART', ['SMART']],
]);
const knownMakes = [...makes.keys()].sort((a, b) => b.length - a.length);
const detectMakes = (text) => {
  const words = String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const wordSet = new Set(words);
  return unique(knownMakes.filter((make) => {
    if (wordSet.has(make)) return true;
    if (make === 'MERCEDESBENZ') return wordSet.has('MERCEDES') && wordSet.has('BENZ');
    if (make === 'LANDROVER') return wordSet.has('LAND') && wordSet.has('ROVER');
    return false;
  }).map((make) => make === 'MERCEDES' ? 'MERCEDESBENZ' : make === 'VW' ? 'VOLKSWAGEN' : normalize(make)));
};
const titleFitmentFor = (row) => String(row.title || '').match(/\|\s*Fits\s+(.+)$/i)?.[1]?.trim() || '';
const vehicleTextFor = (row) => String(row.vehicleTitle || '').trim() || titleFitmentFor(row);
const stripMakePrefix = (model, make) => {
  const words = String(model || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = normalize(words[0]);
  const second = normalize(words[1] || '');
  let remove = 0;
  if (make === 'MERCEDESBENZ' && first === 'MERCEDES' && second === 'BENZ') remove = 2;
  else if (make === 'LANDROVER' && first === 'LAND' && second === 'ROVER') remove = 2;
  else if ((make === 'VOLKSWAGEN' || make === 'VW') && (first === 'VOLKSWAGEN' || first === 'VW')) remove = 1;
  else if (first === make) remove = 1;
  return words.slice(remove).join(' ').trim();
};
const modelsFor = (model, make) => {
  const raw = String(model || '').trim();
  const values = [raw];
  if (make === 'BMW') {
    const code = raw.match(/^[1-8]\d{2}/);
    if (code) values.push(`${code[0][0]} Series`);
  }
  return unique(values);
};

const payload = fs.readFileSync(PAYLOAD_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const client = new PgClient({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ids = payload.map((row) => row.canonicalPartId);
const result = await client.query(`SELECT id, compatibility, "fitmentFlags", "fitmentStatus", "fitmentConfidence", (SELECT count(*)::int FROM "Fitment" f WHERE f."canonicalPartId"="CanonicalPart".id AND f.source ILIKE '%MVL%') AS "mvlFitmentRows" FROM "CanonicalPart" WHERE id=ANY($1::text[]) AND upper(trim(brand))=$2 AND EXISTS (SELECT 1 FROM "SellerOffer" WHERE "canonicalPartId"="CanonicalPart".id AND "sellerId"=$3 AND status='ACTIVE')`, [ids, BRAND, SELLER_ID]);
const current = new Map(result.rows.map((row) => [row.id, row]));
const candidates = [];
for (const row of payload) {
  const part = current.get(row.canonicalPartId);
  if (!part || Number(part.mvlFitmentRows) > 0 || (Array.isArray(part.fitmentFlags) && (part.fitmentFlags.includes('LEMFORDER_FCPEURO') || part.fitmentFlags.includes('MVL_VERIFIED')))) continue;
  const sourceCandidates = Array.isArray(row.compatibilityCandidates) ? row.compatibilityCandidates.filter((candidate) => candidate && candidate.make && candidate.model) : [];
  const vehicleText = vehicleTextFor(row);
  const titleText = (row.productTitle || '') + ' ' + (row.title || '');
  const makeNames = detectMakes(titleText);
  const vehicleModels = vehicleText.split(/[,.&;+]+/).map((value) => stripMakePrefix(value.replace(/\b(and|more)\b/ig, '').trim(), makeNames[0])).filter((value) => value.length >= 2);
  const source = sourceCandidates.length ? 'FCPEURO_URL_FITMENT' : String(row.vehicleTitle || '').trim() ? 'FCPEURO_URL' : 'FCPEURO_URL_TITLE';
  const compatibility = [];
  const seen = new Set();
  if (sourceCandidates.length) {
    for (const candidate of sourceCandidates) {
      const make = candidate.make === 'Mercedes-Benz' || candidate.make === 'Mercedes' ? 'MERCEDESBENZ' : candidate.make === 'Volkswagen' || candidate.make === 'VW' ? 'VOLKSWAGEN' : normalize(candidate.make);
      const model = String(candidate.model || '').trim();
      const yearStart = candidate.yearStart ?? null;
      const yearEnd = candidate.yearEnd ?? null;
      const key = make + '|' + normalize(model) + '|' + (yearStart || '') + '|' + (yearEnd || '');
      if (seen.has(key)) continue;
      seen.add(key);
      compatibility.push({ id: 'fcpeuro-url-fitment-' + normalize(make) + '-' + normalize(model) + '-' + (yearStart || '') + '-' + (yearEnd || ''), year: yearStart && yearStart === yearEnd ? Number(yearStart) : null, yearStart, yearEnd, make, model, trim: candidate.trim || '-', engine: candidate.engine || '-', market: candidate.market || null, source, verificationStatus: 'DECLARED', sourceUrl: row.officialSourceUrl || row.searchUrl || null, notes: 'FCPEuro URL compatibility candidate: ' + candidate.make + ' ' + candidate.model });
    }
  } else {
    for (const make of makeNames) for (const model of vehicleModels) for (const displayModel of modelsFor(model, make)) {
      const key = make + '|' + normalize(displayModel);
      if (seen.has(key)) continue;
      seen.add(key);
      compatibility.push({ id: 'fcpeuro-url-' + normalize(make) + '-' + normalize(displayModel), year: null, yearStart: null, yearEnd: null, make, model: displayModel, trim: '-', engine: '-', market: null, source, verificationStatus: 'DECLARED', sourceUrl: row.officialSourceUrl || row.searchUrl || null, notes: 'FCPEuro fetched title/application text: ' + vehicleText });
    }
  }
  if (compatibility.length) candidates.push({ payload: row, part, vehicleText, source, compatibility });
}
const eligible = payload.filter((row) => {
  const part = current.get(row.canonicalPartId);
  return part && Number(part.mvlFitmentRows) === 0 && !(Array.isArray(part.fitmentFlags) && (part.fitmentFlags.includes('LEMFORDER_FCPEURO') || part.fitmentFlags.includes('MVL_VERIFIED'))) && ((Array.isArray(row.compatibilityCandidates) && row.compatibilityCandidates.length > 0) || vehicleTextFor(row));
});
const report = { createdAt: new Date().toISOString(), mode: APPLY ? 'APPLY' : 'DRY_RUN', payloadRows: payload.length, currentParts: current.size, fallbackParts: candidates.length, fallbackRows: candidates.reduce((sum, row) => sum + row.compatibility.length, 0), urlFitmentCandidateParts: candidates.filter((row) => row.source === 'FCPEURO_URL_FITMENT').length, urlFitmentCandidateRows: candidates.filter((row) => row.source === 'FCPEURO_URL_FITMENT').reduce((sum, row) => sum + row.compatibility.length, 0), vehicleTitleParts: candidates.filter((row) => row.source === 'FCPEURO_URL').length, titleFallbackParts: candidates.filter((row) => row.source === 'FCPEURO_URL_TITLE').length, titleFallbackRows: candidates.filter((row) => row.source === 'FCPEURO_URL_TITLE').reduce((sum, row) => sum + row.compatibility.length, 0), noParsedMakeOrModel: eligible.filter((row) => !candidates.some((candidate) => candidate.payload.canonicalPartId === row.canonicalPartId)).length, parts: candidates.map((row) => ({ canonicalPartId: row.payload.canonicalPartId, mpn: row.payload.manufacturerPartNumber, vehicleTitle: row.payload.vehicleTitle, vehicleText: row.vehicleText, source: row.source, rows: row.compatibility })) };fs.writeFileSync(REPORT_PATH, JSON.stringify(report), 'utf8');
console.log(JSON.stringify({ event: 'url_fallback_summary', ...report, reportPath: REPORT_PATH }));
if (!APPLY) { await client.end(); process.exit(0); }

const backupPath = process.env.LEMFORDER_URL_BACKUP || `${REPORT_PATH}.backup.json`;
fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), parts: candidates.map((row) => row.part) }), 'utf8');
await client.query('BEGIN');
try {
  for (const row of candidates) {
    const flags = [...new Set([...(Array.isArray(row.part.fitmentFlags) ? row.part.fitmentFlags : []), 'FCPEURO_URL_DECLARED'])];
    await client.query(`UPDATE "CanonicalPart" SET compatibility=$2::jsonb, "fitmentStatus"='NEEDS_REVIEW', "fitmentConfidence"=0.55, "fitmentFlags"=$3::text[], "updatedAt"=now() WHERE id=$1`, [row.payload.canonicalPartId, JSON.stringify(row.compatibility), flags]);
    await client.query(`INSERT INTO "SearchOutbox" (id, "entityType", "entityId", operation, status, "availableAt", "createdAt", "updatedAt") SELECT $1,'CanonicalPart',$2,'UPSERT','PENDING',now(),now(),now() WHERE NOT EXISTS (SELECT 1 FROM "SearchOutbox" WHERE "entityType"='CanonicalPart' AND "entityId"=$2 AND operation='UPSERT' AND status='PENDING')`, [crypto.randomUUID(), row.payload.canonicalPartId]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'url_fallback_applied', fallbackParts: candidates.length, fallbackRows: report.fallbackRows, backupPath, reportPath: REPORT_PATH }));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(JSON.stringify({ event: 'url_fallback_rollback', error: error?.message || String(error), backupPath }));
  await client.end(); process.exit(1);
}
await client.end();
