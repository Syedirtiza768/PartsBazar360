#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workDir = path.resolve(process.env.LEMFORDER_WORK_DIR || 'F:/apps/PartsBazar360/tmp/superior-enrichment-workbench');
const catalogPath = path.join(workDir, 'catalog.jsonl');
const compatibilityPath = path.join(workDir, 'compatibility.jsonl');
const offsetsPath = path.join(workDir, 'compatibility-offsets.json');
const outPath = path.resolve(process.env.LEMFORDER_PAYLOAD_OUT || path.join(workDir, 'lemforder-production-replacement.jsonl'));
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const cleanUrl = (value) => { try { const u = new URL(String(value)); u.hash = ''; return u.toString(); } catch { return ''; } };
const unique = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
const evidenceRank = (row) => row?.status === 'ok' ? 2 : 1;

const official = new Map();
for (const name of fs.readdirSync(workDir).filter((x) => /^lemforder.*enrichment.*\.jsonl$/i.test(x))) {
  for (const line of fs.readFileSync(path.join(workDir, name), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row.key) continue;
      const previous = official.get(row.key);
      if (!previous || evidenceRank(row) > evidenceRank(previous) || (evidenceRank(row) === evidenceRank(previous) && String(row.description || '').length > String(previous.description || '').length)) official.set(row.key, row);
    } catch { /* ignore a malformed evidence line; the catalog remains authoritative */ }
  }
}

const groups = new Map();
for (const line of fs.readFileSync(catalogPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (normalize(row.brand) !== 'LEMFORDER') continue;
  const id = String(row.canonicalPartId || '');
  if (!id) continue;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(row);
}
if (!groups.size) throw new Error('No LEMFORDER rows found in catalog');

const offsets = JSON.parse(fs.readFileSync(offsetsPath, 'utf8'));
const compatibilityHandle = fs.openSync(compatibilityPath, 'r');
const readCompatibility = (canonicalPartId) => {
  const meta = offsets[canonicalPartId];
  if (!meta) return [];
  const buffer = Buffer.alloc(Number(meta.length));
  fs.readSync(compatibilityHandle, buffer, 0, buffer.length, Number(meta.offset));
  const parsed = JSON.parse(buffer.toString('utf8'));
  return Array.isArray(parsed.compatibility) ? parsed.compatibility : [];
};

const output = [];
for (const [canonicalPartId, candidates] of groups) {
  candidates.sort((a, b) => Number(b.price || 0) - Number(a.price || 0) || String(a.listingId).localeCompare(String(b.listingId)));
  const source = candidates[0];
  const mpn = String(source.manufacturerPartNumber || '').trim();
  const evidence = official.get(`LEMFORDER|${normalize(mpn)}`) || null;
  const evidenceIsVerified = evidence?.status === 'ok';
  const evidenceOe = evidenceIsVerified
    ? (evidence.oeReferences || []).flatMap((ref) => Array.isArray(ref?.numbers) ? ref.numbers : [])
    : [];
  const oeNumbers = unique([source.oemPartNumber, ...evidenceOe]);
  const imageUrls = unique([...(source.currentImageUrls || []), ...(source.currentImageUrls?.length ? [] : (evidenceIsVerified ? (evidence.imageUrls || []) : []))].map(cleanUrl));
  const itemSpecifics = Array.isArray(source.itemSpecifics) && source.itemSpecifics.length
    ? source.itemSpecifics
    : (source.itemSpecifics && typeof source.itemSpecifics === 'object' ? source.itemSpecifics : (evidenceIsVerified && Array.isArray(evidence?.itemSpecifics) ? evidence.itemSpecifics : []));
  const compatibilityCandidates = readCompatibility(canonicalPartId);
  output.push({
    listingId: String(source.listingId || ''),
    sourceListingIds: candidates.map((row) => String(row.listingId || '')).filter(Boolean),
    canonicalPartId,
    brand: 'LEMFORDER',
    manufacturerPartNumber: mpn,
    title: String(source.suggestedTitle || source.originalTitle || '').trim(),
    description: evidenceIsVerified && String(evidence.description || '').trim() ? String(evidence.description).trim() : null,
    replaceDescription: Boolean(evidenceIsVerified && String(evidence.description || '').trim()),
    oeNumbers,
    imageUrls,
    itemSpecifics,
    officialSourceUrl: evidenceIsVerified ? String(evidence.sourceUrl || evidence.selectedProductUrl || '').trim() : '',
    searchUrl: String(evidence?.searchUrl || source.lemforderSearchUrl || '').trim(),
    productTitle: evidenceIsVerified ? String(evidence.title || '').trim() : '',
    vehicleTitle: evidenceIsVerified ? String(evidence.vehicleTitle || '').trim() : '',
    applicationShortDescription: evidenceIsVerified ? String(evidence.applicationShortDescription || '').trim() : '',
    evidenceStatus: String(evidence?.status || 'missing'),
    evidenceSelectedResultIndex: evidence?.selectedResultIndex ?? null,
    evidenceModel: String(evidence?.model || ''),
    compatibilityCandidates,
    existingCompatibilityCount: compatibilityCandidates.length,
    sourceUpdatedAt: String(source.sourceUpdatedAt || ''),
  });
}
fs.closeSync(compatibilityHandle);
fs.writeFileSync(outPath, output.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
const stats = {
  rows: output.length,
  sourceListings: output.reduce((sum, row) => sum + row.sourceListingIds.length, 0),
  evidenceOk: output.filter((row) => row.evidenceStatus === 'ok').length,
  withImages: output.filter((row) => row.imageUrls.length).length,
  withOeNumbers: output.filter((row) => row.oeNumbers.length).length,
  withItemSpecifics: output.filter((row) => Array.isArray(row.itemSpecifics) ? row.itemSpecifics.length : Object.keys(row.itemSpecifics || {}).length).length,
  withExistingCompatibility: output.filter((row) => row.existingCompatibilityCount > 0).length,
  totalExistingCompatibilityCandidates: output.reduce((sum, row) => sum + row.existingCompatibilityCount, 0),
  bytes: fs.statSync(outPath).size,
  outPath,
};
console.log(JSON.stringify(stats));
