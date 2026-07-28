import fs from 'node:fs';

const html = fs.readFileSync('f:/apps/PartsBazar360/tmp/febest-sample.html', 'utf8');
const cat = fs.readFileSync('f:/apps/PartsBazar360/tmp/febest-catalog-code.html', 'utf8');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const code = 'MZAB-B2500L';
const codeSlug = code.toLowerCase().replace(/-/g, '_');
const exact = new RegExp(`href="(/en/details/[^"]*-${escapeRegExp(codeSlug)})"`, 'i');
console.log('details', cat.match(exact)?.[1]);

const imgs = [...html.matchAll(/https:\/\/static\.febest\.de\/images\/[^"'>\s]+/gi)].map((m) => m[0]);
console.log('images', [...new Set(imgs)].slice(0, 5));

const oem = html.match(/id="oem_select"[^>]*>([\s\S]*?)<\/select>/i);
console.log(
  'oems',
  [...oem[1].matchAll(/value="([^"]*)"/gi)].map((m) => m[1]).filter((v) => v && v !== '0'),
);

const mod = html.match(/id="model_list"[^>]*>([\s\S]*?)<\/select>/i);
const models = [...mod[1].matchAll(/value="([^"]*)"/gi)].map((m) => m[1]).filter(Boolean);
console.log('models', models.length, models[0]);

const m = models[0].match(/^(\S+)\s+(.+?)\s+(\d{4})\s*-\s*(\d{4})?\s*\[([^\]]+)\]\s*$/);
console.log('parse', m && m.slice(1));
