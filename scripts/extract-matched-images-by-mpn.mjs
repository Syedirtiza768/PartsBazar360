import fs from 'node:fs';

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizePartNumber(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const raw = fs.readFileSync('F:/apps/PartsBazar360/outputs/superior-listings-enriched.csv', 'utf8');
const rows = parseCSV(raw);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

const byKey = new Map(); // normalizedMpn -> { url, count }
const urlRe = /^https?:\/\/\S+$/i;
let matched = 0, noMpn = 0, dupKey = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < header.length) continue;
  const status = (r[idx.imageLookupStatus] || '').trim();
  if (status !== 'matched') continue;
  matched++;
  const url = (r[idx.imageUrls] || '').trim();
  if (!url || !urlRe.test(url)) continue;
  const mpnRaw = (r[idx.mfr_part_number] || r[idx.seller_sku] || '').trim();
  const key = normalizePartNumber(mpnRaw);
  if (!key) { noMpn++; continue; }
  if (byKey.has(key)) { dupKey++; continue; } // keep first, avoid ambiguous multi-match
  byKey.set(key, url);
}

const out = [...byKey.entries()].map(([k, u]) => `${k}\t${u}`).join('\n') + '\n';
fs.writeFileSync('F:/apps/PartsBazar360/scripts/matched-images-by-mpn.tsv', out);
console.log(JSON.stringify({ matchedStatus: matched, uniqueKeys: byKey.size, noMpn, dupKeySkipped: dupKey }, null, 2));
