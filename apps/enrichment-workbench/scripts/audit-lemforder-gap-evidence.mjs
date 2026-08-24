import fs from 'node:fs';

const gapPath = process.argv[2];
const evidencePath = process.argv[3];
const gaps = new Set(fs.readFileSync(gapPath, 'utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
const rows = fs.readFileSync(evidencePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const matched = rows.filter((row) => gaps.has(String(row.mpn || '').trim()));
const withVehicleTitle = matched.filter((row) => String(row.vehicleTitle || '').trim() && String(row.vehicleTitle).trim() !== '& more');
const withProductUrl = matched.filter((row) => String(row.selectedProductUrl || '').trim());
const withSearchResults = matched.filter((row) => Array.isArray(row.searchResults) && row.searchResults.length > 0);
console.log(JSON.stringify({
  gapCount: gaps.size,
  matchedRows: matched.length,
  withVehicleTitle: withVehicleTitle.length,
  withProductUrl: withProductUrl.length,
  withSearchResults: withSearchResults.length,
  examples: withVehicleTitle.slice(0, 20).map((row) => ({ mpn: row.mpn, selectedProductUrl: row.selectedProductUrl, title: row.title, vehicleTitle: row.vehicleTitle })),
}));
