import fs from 'node:fs';
import path from 'node:path';

const workDir = path.resolve('F:/apps/PartsBazar360/tmp/superior-enrichment-workbench');
const catalogPath = path.join(workDir, 'catalog.jsonl');
const outPath = path.join(workDir, 'febi-production-replacement.jsonl');
const normalize = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const validReference = (value) => {
  const raw = String(value ?? '').trim();
  const n = normalize(raw);
  return Boolean(raw) && n.length >= 5 && (raw.match(/[0-9]/g) || []).length >= 4 && !/-X[0-9]+$/i.test(raw);
};
const official = new Map();
for (const name of fs.readdirSync(workDir).filter((x) => /^febi-url-luna-enrichment-batch-.*\.jsonl$/i.test(x))) {
  for (const line of fs.readFileSync(path.join(workDir, name), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); if (row.status === 'ok' && row.key) official.set(row.key, row); } catch {}
  }
}
const rows = [];
for (const line of fs.readFileSync(catalogPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.brand !== 'FEBI' || c.febiUrlEnrichmentApplied !== true) continue;
  const key = `FEBI|${normalize(c.manufacturerPartNumber)}`;
  const o = official.get(key);
  if (!o) throw new Error(`Missing official result for ${key}`);
  const refs = [...new Set((o.oeReferences || []).flatMap((ref) => Array.isArray(ref?.numbers) ? ref.numbers : []).map((v) => String(v).trim()).filter(validReference))];
  if (refs.length === 0 && validReference(c.oemPartNumber)) refs.push(String(c.oemPartNumber).trim());
  const images = [...new Set((o.imageUrls || []).map(String).filter((url) => /^https?:\/\/[^/]*partsfinder\.bilsteingroup\.com\//i.test(url) && !/pf-notfound|robot\.png|facebook\.com\/tr\?/i.test(url)))];
  const zoomed = images.filter((url) => /pf-article-zoomed/i.test(url));
  const imageUrls = [...zoomed, ...images.filter((url) => !zoomed.includes(url))];
  if (imageUrls.length === 0) imageUrls.push(...(c.currentImageUrls || []));
  const itemSpecifics = {
    manufacturer: 'FEBI',
    manufacturerPartNumber: String(c.manufacturerPartNumber || ''),
    fittingPosition: String(o.fittingPosition || ''),
    officialArticleNumber: String(o.articleNumber || ''),
    officialSourceUrl: String(o.sourceUrl || ''),
    officialAttributes: Array.isArray(o.attributes) ? o.attributes : [],
    officialDocuments: Array.isArray(o.documents) ? o.documents : [],
    officialRelatedArticles: Array.isArray(o.relatedArticles) ? o.relatedArticles : [],
    enrichmentProvider: 'OpenRouter',
    enrichmentModel: 'openai/gpt-5.6-luna',
    evidence: String(o.evidence || ''),
    enrichedAt: new Date().toISOString(),
  };
  rows.push({
    listingId: String(c.listingId),
    canonicalPartId: String(c.canonicalPartId),
    brand: 'FEBI',
    manufacturerPartNumber: String(c.manufacturerPartNumber || ''),
    title: String(c.suggestedTitle || ''),
    description: String(o.description || ''),
    oeNumbers: refs,
    imageUrls,
    itemSpecifics,
    officialSourceUrl: String(o.sourceUrl || ''),
    officialArticleNumber: String(o.articleNumber || ''),
    officialStatus: String(o.status || ''),
    sourceUpdatedAt: String(c.sourceUpdatedAt || ''),
  });
}
fs.writeFileSync(outPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
const withOe = rows.filter((row) => row.oeNumbers.length).length;
const withImages = rows.filter((row) => row.imageUrls.length).length;
const withZoomed = rows.filter((row) => /pf-article-zoomed/i.test(row.imageUrls[0] || '')).length;
console.log(JSON.stringify({ rows: rows.length, officialResults: official.size, withOe, withImages, withZoomed, bytes: fs.statSync(outPath).size }));