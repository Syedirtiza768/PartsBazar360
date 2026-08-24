#!/usr/bin/env node
import fs from 'node:fs';
import { Client as PgClient } from 'pg';

const PAYLOAD_PATH = process.env.LEMFORDER_PAYLOAD || '/tmp/lemforder-production-replacement.jsonl';
const REPORT_PATH = process.env.LEMFORDER_MVL_REPORT || `/tmp/lemforder-mvl-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const APPLY = process.argv.includes('--apply');
const SELLER_ID = 'seller-superior-auto-parts';
const BRAND = 'LEMFORDER';
const BATCH_SIZE = Math.max(100, Math.min(Number(process.env.LEMFORDER_MVL_QUERY_BATCH || 500), 2000));
const MARKETS = ['DE', 'UK', 'AU', 'US'];
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const unique = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
const makeAliases = new Map([
  ['BMW', ['BMW']], ['AUDI', ['AUDI']], ['PORSCHE', ['PORSCHE']],
  ['VOLKSWAGEN', ['VOLKSWAGEN', 'VW']], ['VW', ['VOLKSWAGEN', 'VW']],
  ['MERCEDESBENZ', ['MERCEDESBENZ', 'MERCEDES']], ['MERCEDES', ['MERCEDESBENZ', 'MERCEDES']],
  ['MINI', ['MINI']], ['VOLVO', ['VOLVO']], ['SAAB', ['SAAB']], ['JAGUAR', ['JAGUAR']],
  ['LANDROVER', ['LANDROVER', 'LAND ROVER']], ['SMART', ['SMART']], ['FORD', ['FORD']],
  ['TOYOTA', ['TOYOTA']], ['LEXUS', ['LEXUS']], ['HONDA', ['HONDA']], ['NISSAN', ['NISSAN']],
  ['INFINITI', ['INFINITI']], ['SUBARU', ['SUBARU']], ['MAZDA', ['MAZDA']], ['MITSUBISHI', ['MITSUBISHI']],
  ['HYUNDAI', ['HYUNDAI']], ['KIA', ['KIA']], ['RENAULT', ['RENAULT']], ['PEUGEOT', ['PEUGEOT']],
  ['CITROEN', ['CITROEN']], ['FIAT', ['FIAT']], ['ALFA ROMEO', ['ALFA ROMEO', 'ALFAROMEO']],
]);
const knownMakes = [...makeAliases.keys()].sort((a, b) => b.length - a.length);
const makeKeys = (name) => makeAliases.get(String(name || '').toUpperCase()) || [String(name || '')];
const detectedMakes = (text) => {
  const words = String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const wordSet = new Set(words);
  return knownMakes.filter((name) => {
    const key = normalize(name);
    if (wordSet.has(key)) return true;
    if (key === 'MERCEDESBENZ' || key === 'LANDROVER' || key === 'ALFAROMEO') return wordSet.has(key.slice(0, key.length - (key === 'ALFAROMEO' ? 5 : key === 'LANDROVER' ? 5 : 4))) && wordSet.has(key.slice(- (key === 'ALFAROMEO' ? 5 : key === 'LANDROVER' ? 5 : 4)));
    return false;
  }).flatMap(makeKeys).map(normalize).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index);
};
const modelKeys = (model, makeNorm) => {
  const raw = String(model || '').trim();
  const out = [normalize(raw)];
  if (makeNorm === 'BMW') {
    const match = raw.match(/^[1-8]\d{2}/);
    if (match) out.push(`${match[0][0]} Series`);
  }
  return unique(out.map(normalize));
};
const yearValues = (candidate) => {
  const start = Number.parseInt(String(candidate.yearStart ?? candidate.year ?? ''), 10);
  const end = Number.parseInt(String(candidate.yearEnd ?? candidate.year ?? ''), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const from = Math.max(1950, Math.min(start, end));
  const to = Math.min(2035, Math.max(start, end));
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
};

const payload = fs.readFileSync(PAYLOAD_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (!payload.length) throw new Error('Empty Lemforder payload');
const client = new PgClient({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ids = payload.map((row) => row.canonicalPartId);
const scope = await client.query(`SELECT cp.id, cp.brand, cp.title, cp."manufacturerPartNumber", cp.compatibility, cp."fitmentFlags" FROM "CanonicalPart" cp WHERE cp.id=ANY($1::text[]) AND upper(trim(cp.brand))=$2 AND EXISTS (SELECT 1 FROM "SellerOffer" so WHERE so."canonicalPartId"=cp.id AND so."sellerId"=$3 AND so.status='ACTIVE')`, [ids, BRAND, SELLER_ID]);
const scopeMap = new Map(scope.rows.map((row) => [row.id, row]));
const scopedPayload = payload.filter((row) => scopeMap.has(row.canonicalPartId));

const requestMap = new Map();
const partRequests = new Map();
const addRequest = (partId, makeNorm, modelNorm, year, source) => {
  if (!makeNorm || !modelNorm) return;
  const key = `${makeNorm}|${modelNorm}|${year == null ? '*' : year}`;
  if (!requestMap.has(key)) requestMap.set(key, { makeNorm, modelNorm, year: year == null ? null : Number(year) });
  if (!partRequests.has(partId)) partRequests.set(partId, []);
  const arr = partRequests.get(partId);
  if (!arr.some((item) => item.key === key)) arr.push({ key, source });
};
for (const row of scopedPayload) {
  for (const candidate of Array.isArray(row.compatibilityCandidates) ? row.compatibilityCandidates : []) {
    const makes = makeKeys(candidate.make).map(normalize).filter(Boolean);
    const models = modelKeys(candidate.model, makes[0]);
    const years = yearValues(candidate);
    for (const makeNorm of makes) for (const modelNorm of models) for (const year of years) addRequest(row.canonicalPartId, makeNorm, modelNorm, year, 'application_compatibility');
  }
  const titleText = `${row.title || ''} ${row.productTitle || ''}`;
  const titleMakes = detectedMakes(titleText);
  const vehicleModels = String(row.vehicleTitle || '').split(/[,.&;+]+/).map((part) => part.replace(/\b(and|more)\b/ig, '').trim()).filter((part) => part.length >= 2);
  if (vehicleModels.length && titleMakes.length) {
    for (const makeNorm of titleMakes) for (const model of vehicleModels) for (const modelNorm of modelKeys(model, makeNorm)) addRequest(row.canonicalPartId, makeNorm, modelNorm, null, 'fcpeuro_vehicle_title');
  }
  if (!partRequests.has(row.canonicalPartId)) partRequests.set(row.canonicalPartId, []);
}

const mvlByRequest = new Map();
const requestRows = [...requestMap.values()];
for (let offset = 0; offset < requestRows.length; offset += BATCH_SIZE) {
  const batch = requestRows.slice(offset, offset + BATCH_SIZE);
  const makes = batch.map((row) => row.makeNorm);
  const models = batch.map((row) => row.modelNorm);
  const years = batch.map((row) => row.year);
  const result = await client.query(`
    SELECT mv.id, mv.epid, mv."kType", mv.market, mv.year, mv.make, mv.model, mv.trim, mv.submodel, mv.engine, mv."driveType", mv."fuelType", mv.body, mv."displayName", mv."normalizedMake", mv."normalizedModel"
    FROM "MvlVehicle" mv
    JOIN unnest($1::text[], $2::text[], $3::int[]) AS k(make_norm, model_norm, requested_year)
      ON mv."normalizedMake"=k.make_norm AND mv."normalizedModel"=k.model_norm AND (k.requested_year IS NULL OR mv.year=k.requested_year)
    WHERE mv.market = ANY($4::text[])
    ORDER BY mv.market, mv.year, mv."normalizedMake", mv."normalizedModel", mv.trim NULLS LAST, mv.engine NULLS LAST, mv.id
  `, [makes, models, years, MARKETS]);
  for (const vehicle of result.rows) {
    const dedupeKey = `${vehicle.market}|${vehicle.year}|${vehicle.normalizedMake}|${vehicle.normalizedModel}|${vehicle.normalizedMake}|${vehicle.normalizedModel}`;
    for (const key of [`${vehicle.normalizedMake}|${vehicle.normalizedModel}|${vehicle.year}`, `${vehicle.normalizedMake}|${vehicle.normalizedModel}|*`]) {
      if (!mvlByRequest.has(key)) mvlByRequest.set(key, []);
      const rows = mvlByRequest.get(key);
      if (!rows.some((item) => item._dedupeKey === dedupeKey)) rows.push({ ...vehicle, _dedupeKey: dedupeKey });
    }
  }
  console.log(JSON.stringify({ event: 'mvl_query_batch', offset, batch: batch.length, requestCount: requestRows.length, matchedRows: result.rows.length }));
}

const matches = [];
for (const row of scopedPayload) {
  const requests = partRequests.get(row.canonicalPartId) || [];
  const exactRequests = requests.filter((request) => request.source === 'application_compatibility');
  const exactRows = exactRequests.flatMap((request) => (mvlByRequest.get(request.key) || []).map((vehicle) => ({ vehicle, source: request.source })));
  const chosen = exactRows.length ? exactRows : requests.flatMap((request) => (mvlByRequest.get(request.key) || []).map((vehicle) => ({ vehicle, source: request.source })));
  const uniqueRows = [];
  const seen = new Set();
  for (const item of chosen) {
    const v = item.vehicle;
    const key = `${v.market}|${v.year}|${v.normalizedMake}|${v.normalizedModel}|${v.trim || ''}|${v.engine || ''}|${v.epid || v.kType || v.id}`;
    if (seen.has(key)) continue;
    seen.add(key); uniqueRows.push({ ...v, matchSource: item.source });
  }
  matches.push({ payload: row, existing: scopeMap.get(row.canonicalPartId), vehicles: uniqueRows });
}

const report = {
  createdAt: new Date().toISOString(),
  mode: APPLY ? 'APPLY' : 'DRY_RUN',
  payloadRows: payload.length,
  scopedRows: scopedPayload.length,
  requestCount: requestRows.length,
  matchedParts: matches.filter((row) => row.vehicles.length).length,
  unmatchedParts: matches.filter((row) => !row.vehicles.length).length,
  matchedVehicleRows: matches.reduce((sum, row) => sum + row.vehicles.length, 0),
  unmatched: matches.filter((row) => !row.vehicles.length).map((row) => ({ canonicalPartId: row.payload.canonicalPartId, mpn: row.payload.manufacturerPartNumber, title: row.payload.title, vehicleTitle: row.payload.vehicleTitle, candidateRows: row.payload.compatibilityCandidates?.length || 0 })),
};
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ...report, matches: matches.map((row) => ({ canonicalPartId: row.payload.canonicalPartId, mpn: row.payload.manufacturerPartNumber, matchSource: row.vehicles[0]?.matchSource || null, vehicleRowCount: row.vehicles.length, vehicleRowsSample: row.vehicles.slice(0, 20).map((vehicle) => ({ id: vehicle.id, market: vehicle.market, year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim, engine: vehicle.engine, epid: vehicle.epid, kType: vehicle.kType })) })) }), 'utf8');
console.log(JSON.stringify({ event: 'mvl_match_summary', ...report, reportPath: REPORT_PATH }));
if (!APPLY) { await client.end(); process.exit(0); }

const matched = matches.filter((row) => row.vehicles.length);
const targetIds = matched.map((row) => row.payload.canonicalPartId);
const backup = { createdAt: new Date().toISOString(), parts: [], fitments: [], fitmentEvidence: [] };
const oldParts = await client.query(`SELECT id, compatibility, "fitmentFlags", "fitmentStatus", "fitmentConfidence", "updatedAt" FROM "CanonicalPart" WHERE id=ANY($1::text[])`, [targetIds]);
const oldFitments = targetIds.length ? await client.query(`SELECT * FROM "Fitment" WHERE "canonicalPartId"=ANY($1::text[])`, [targetIds]) : { rows: [] };
const oldEvidence = oldFitments.rows.length ? await client.query(`SELECT * FROM "FitmentEvidence" WHERE "fitmentId"=ANY($1::text[])`, [oldFitments.rows.map((row) => row.id)]) : { rows: [] };
backup.parts = oldParts.rows; backup.fitments = oldFitments.rows; backup.fitmentEvidence = oldEvidence.rows;
const backupPath = process.env.LEMFORDER_MVL_BACKUP || `${REPORT_PATH}.backup.json`;
fs.writeFileSync(backupPath, JSON.stringify(backup), 'utf8');

const flattened = [];
const seenFlattened = new Set();
const compatibilityByPart = new Map();
for (const match of matched) {
  const partId = match.payload.canonicalPartId;
  const compatibility = [];
  for (const vehicle of match.vehicles) {
    const normalizedKey = `${vehicle.market}|${vehicle.year}|${vehicle.normalizedMake}|${vehicle.normalizedModel}`;
    const rowKey = `${partId}|${normalizedKey}`;
    if (seenFlattened.has(rowKey)) continue;
    seenFlattened.add(rowKey);
    const trim = String(vehicle.trim || '').trim();
    const engine = String(vehicle.engine || '').trim();
    flattened.push({ partId, vehicleId: String(vehicle.id), make: String(vehicle.make), model: String(vehicle.model), year: Number(vehicle.year), trim, engine, market: String(vehicle.market), matchSource: String(vehicle.matchSource || 'MVL') });
    compatibility.push({ id: `mvl-${vehicle.market}-${vehicle.id}`, year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: trim || '-', engine: engine || '-', market: vehicle.market, epid: vehicle.epid || null, kType: vehicle.kType || null, displayName: vehicle.displayName || null, source: 'MVL' });
  }
  compatibilityByPart.set(partId, compatibility);
}

await client.query('BEGIN');
try {
  await client.query(`CREATE TEMP TABLE lemforder_mvl_rows (
    part_id text NOT NULL,
    vehicle_id text NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    year int NOT NULL,
    trim text NOT NULL,
    engine text NOT NULL,
    market text NOT NULL,
    match_source text NOT NULL,
    PRIMARY KEY (part_id, market, year, make, model)
  ) ON COMMIT DROP`);
  for (let offset = 0; offset < flattened.length; offset += 5000) {
    const batch = flattened.slice(offset, offset + 5000);
    await client.query(`INSERT INTO lemforder_mvl_rows (part_id, vehicle_id, make, model, year, trim, engine, market, match_source) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[], $8::text[], $9::text[]) ON CONFLICT DO NOTHING`, [
      batch.map((row) => row.partId), batch.map((row) => row.vehicleId), batch.map((row) => row.make), batch.map((row) => row.model), batch.map((row) => row.year), batch.map((row) => row.trim), batch.map((row) => row.engine), batch.map((row) => row.market), batch.map((row) => row.matchSource),
    ]);
    if (offset % 25000 === 0) console.log(JSON.stringify({ event: 'mvl_stage_progress', rows: Math.min(offset + batch.length, flattened.length), total: flattened.length }));
  }
  await client.query(`INSERT INTO "VehicleMake" (id, name, "canonicalName", "displayName") SELECT gen_random_uuid(), x.make, x.make, x.make FROM (SELECT DISTINCT make FROM lemforder_mvl_rows) x ON CONFLICT (name) DO NOTHING`);
  await client.query(`INSERT INTO "VehicleModel" (id, "makeId", name) SELECT gen_random_uuid(), vm.id, x.model FROM (SELECT DISTINCT make, model FROM lemforder_mvl_rows) x JOIN "VehicleMake" vm ON vm.name=x.make WHERE NOT EXISTS (SELECT 1 FROM "VehicleModel" existing WHERE existing."makeId"=vm.id AND existing.name=x.model)`);
  await client.query(`INSERT INTO "VehicleGeneration" (id, "modelId", name, "startYear", "endYear") SELECT gen_random_uuid(), mdl.id, concat(x.model, ' ', x.year), x.year, x.year FROM (SELECT DISTINCT make, model, year FROM lemforder_mvl_rows) x JOIN "VehicleMake" vm ON vm.name=x.make JOIN "VehicleModel" mdl ON mdl."makeId"=vm.id AND mdl.name=x.model WHERE NOT EXISTS (SELECT 1 FROM "VehicleGeneration" existing WHERE existing."modelId"=mdl.id AND existing."startYear"=x.year AND existing."endYear"=x.year)`);
  await client.query(`INSERT INTO "VehicleConfiguration" (id, "generationId", trim, engine, market) SELECT gen_random_uuid(), gen.id, NULLIF(x.trim,''), NULLIF(x.engine,''), x.market FROM (SELECT DISTINCT make, model, year, trim, engine, market FROM lemforder_mvl_rows) x JOIN "VehicleMake" vm ON vm.name=x.make JOIN "VehicleModel" mdl ON mdl."makeId"=vm.id AND mdl.name=x.model JOIN "VehicleGeneration" gen ON gen."modelId"=mdl.id AND gen."startYear"=x.year AND gen."endYear"=x.year WHERE NOT EXISTS (SELECT 1 FROM "VehicleConfiguration" existing WHERE existing."generationId"=gen.id AND existing.trim IS NOT DISTINCT FROM NULLIF(x.trim,'') AND existing.engine IS NOT DISTINCT FROM NULLIF(x.engine,'') AND existing.market IS NOT DISTINCT FROM x.market)`);
  let partIndex = 0;
  for (const [partId, compatibility] of compatibilityByPart) {
    const current = scopeMap.get(partId);
    const oldFlags = Array.isArray(current?.fitmentFlags) ? current.fitmentFlags : [];
    const flags = [...new Set([...oldFlags, 'MVL_VERIFIED', 'LEMFORDER_FCPEURO'])];
    await client.query(`UPDATE "CanonicalPart" SET compatibility=$2::jsonb, "fitmentStatus"='CONFIRMED', "fitmentConfidence"=0.9, "fitmentFlags"=$3::text[], "updatedAt"=now() WHERE id=$1`, [partId, JSON.stringify(compatibility), flags]);
    partIndex++;
    if (partIndex % 100 === 0) console.log(JSON.stringify({ event: 'mvl_part_progress', parts: partIndex, total: compatibilityByPart.size }));
  }
  await client.query(`INSERT INTO "Fitment" (id, "canonicalPartId", "vehicleConfigId", "evidenceLevel", confidence, reviewer, source, "verificationStatus", reason, "createdAt", "updatedAt") SELECT gen_random_uuid(), rows.part_id, config.id, 'B', 0.9, 'Auto (FCPEuro title + MVL)', 'LEMFORDER_FCPEURO_MVL', 'VERIFIED', concat('Matched ', rows.match_source, ' to ', rows.market, ' MVL ', rows.year), now(), now() FROM lemforder_mvl_rows rows JOIN "VehicleMake" vm ON vm.name=rows.make JOIN "VehicleModel" mdl ON mdl."makeId"=vm.id AND mdl.name=rows.model JOIN "VehicleGeneration" gen ON gen."modelId"=mdl.id AND gen."startYear"=rows.year AND gen."endYear"=rows.year JOIN LATERAL (SELECT config.id FROM "VehicleConfiguration" config WHERE config."generationId"=gen.id AND config.trim IS NOT DISTINCT FROM NULLIF(rows.trim,'') AND config.engine IS NOT DISTINCT FROM NULLIF(rows.engine,'') AND config.market IS NOT DISTINCT FROM rows.market ORDER BY config.id LIMIT 1) config ON TRUE ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO UPDATE SET "evidenceLevel"='B', confidence=0.9, reviewer='Auto (FCPEuro title + MVL)', source='LEMFORDER_FCPEURO_MVL', "verificationStatus"='VERIFIED', reason=EXCLUDED.reason, "updatedAt"=now()`);
  await client.query(`INSERT INTO "FitmentEvidence" (id, "fitmentId", "evidenceType", "evidenceLevel", confidence, source, "originalValue", "normalizedValue", reason, "verifiedBy", "verifiedAt") SELECT gen_random_uuid(), f.id, 'TITLE_PARSE', 'B', 0.9, 'LEMFORDER_FCPEURO_MVL', jsonb_build_object('source', 'FCPEuro application vehicle title'), jsonb_build_object('source', 'MVL', 'market', split_part(f.reason, ' to ', 2)), 'FCPEuro application vehicle data matched to MVL', 'Auto (FCPEuro title + MVL)', now() FROM "Fitment" f WHERE f."canonicalPartId"=ANY($1::text[]) AND f.source='LEMFORDER_FCPEURO_MVL' AND NOT EXISTS (SELECT 1 FROM "FitmentEvidence" fe WHERE fe."fitmentId"=f.id AND fe."evidenceType"='TITLE_PARSE' AND fe.source='LEMFORDER_FCPEURO_MVL')`, [targetIds]);
  await client.query(`INSERT INTO "SearchOutbox" (id, "entityType", "entityId", operation, status, "availableAt", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'CanonicalPart', x.part_id, 'UPSERT', 'PENDING', now(), now(), now() FROM unnest($1::text[]) AS x(part_id) WHERE NOT EXISTS (SELECT 1 FROM "SearchOutbox" WHERE "entityType"='CanonicalPart' AND "entityId"=x.part_id AND operation='UPSERT' AND status='PENDING')`, [targetIds]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'mvl_apply_done', updatedParts: compatibilityByPart.size, matchedVehicleRows: flattened.length, unmatchedParts: report.unmatchedParts, backupPath, reportPath: REPORT_PATH, searchOutboxRequested: targetIds.length }));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(JSON.stringify({ event: 'mvl_apply_rollback', error: error?.message || String(error), backupPath }));
  await client.end(); process.exit(1);
}
await client.end();