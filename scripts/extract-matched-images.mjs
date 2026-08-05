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

const raw = fs.readFileSync('F:/apps/PartsBazar360/outputs/superior-listings-enriched.csv', 'utf8');
const rows = parseCSV(raw);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

const out = [];
let matched = 0, skippedBadUrl = 0;
const urlRe = /^https?:\/\/\S+$/i;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < header.length) continue;
  const status = (r[idx.imageLookupStatus] || '').trim();
  const url = (r[idx.imageUrls] || '').trim();
  const id = (r[idx.listing_id] || '').trim();
  if (status !== 'matched') continue;
  matched++;
  if (!id || !url || !urlRe.test(url)) { skippedBadUrl++; continue; }
  out.push(`${id}\t${url}`);
}

fs.writeFileSync('F:/apps/PartsBazar360/scripts/matched-image-urls.tsv', out.join('\n') + '\n');
console.log(JSON.stringify({ totalRows: rows.length - 1, matchedStatus: matched, usableRows: out.length, skippedBadUrl }, null, 2));
