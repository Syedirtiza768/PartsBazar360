import fs from 'node:fs';

const gaps = new Set(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
const rows = fs.readFileSync(process.argv[3], 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const selected = rows.filter((row) => gaps.has(String(row.mpn || '').trim()) && String(row.vehicleTitle || '').trim() && String(row.vehicleTitle).trim() !== '& more');
fs.writeFileSync(process.argv[4], selected.map((row) => JSON.stringify(row)).join('\n') + (selected.length ? '\n' : ''), 'utf8');
console.log(JSON.stringify({ selected: selected.length, mpns: selected.map((row) => row.mpn) }));
