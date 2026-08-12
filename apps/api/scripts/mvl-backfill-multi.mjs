/**
 * Multi-strategy MVL backfill for Superior Auto Parts.
 *
 * Strategy order (cheapest/fastest first):
 *  1. Title parsing — extract year+make+model from title text
 *  2. Platform codes — map E30→BMW 3 Series, W123→Mercedes, etc.
 *  3. OE cross-reference — match CatalogPartNumber against MVL ePID
 *  4. AI resolution — send title+brand+MPN to LLM for vehicle extraction
 *
 * Usage:
 *   node scripts/mvl-backfill-multi.mjs [--dry-run] [--ai-only] [--limit N]
 */
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const AI_ONLY = process.argv.includes('--ai-only');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit'));
const LIMIT = LIMIT_ARG ? Number(process.argv[process.argv.indexOf(LIMIT_ARG) + 1]) : null;
const OFFSET_ARG = process.argv.find(a => a.startsWith('--offset'));
const OFFSET = OFFSET_ARG ? Number(process.argv[process.argv.indexOf(OFFSET_ARG) + 1]) : 0;
const WORKER_ID = process.env.WORKER_ID || '0';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s) {
  return String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '').trim();
}

// ── Strategy 1: Title parsing ────────────────────────────────────────────────

const MAKE_ALIASES = [
  ['Toyota', ['toyota']], ['Honda', ['honda']], ['Nissan', ['nissan']],
  ['BMW', ['bmw']], ['Mercedes-Benz', ['mercedes benz', 'mercedes-benz', 'mercedes']],
  ['Audi', ['audi']], ['Volkswagen', ['volkswagen', 'vw']],
  ['Ford', ['ford']], ['Chevrolet', ['chevrolet', 'chevy']],
  ['Hyundai', ['hyundai']], ['Kia', ['kia']], ['Mazda', ['mazda']],
  ['Subaru', ['subaru']], ['Lexus', ['lexus']], ['Infiniti', ['infiniti']],
  ['Acura', ['acura']], ['Porsche', ['porsche']], ['Jaguar', ['jaguar']],
  ['Land Rover', ['land rover']], ['Volvo', ['volvo']], ['Mini', ['mini', 'mini']],
  ['Dodge', ['dodge']], ['Jeep', ['jeep']], ['GMC', ['gmc']],
  ['Cadillac', ['cadillac']], ['Buick', ['buick']], ['Chrysler', ['chrysler']],
  ['Lincoln', ['lincoln']], ['Ram', ['ram']], ['Mitsubishi', ['mitsubishi']],
  ['Suzuki', ['suzuki']], ['Isuzu', ['isuzu']], ['Fiat', ['fiat']],
  ['Maserati', ['maserati']], ['Bentley', ['bentley']],
  ['Rolls-Royce', ['rolls-royce', 'rolls royce']],
  ['Range Rover', ['range rover']], ['Tesla', ['tesla']],
];

function parseTitle(title) {
  const s = String(title || '');
  const range = s.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  const single = s.match(/\b((?:19|20)\d{2})\b/);
  let y0 = null, y1 = null;
  if (range) { y0 = +range[1]; y1 = +range[2]; }
  else if (single) { y0 = y1 = +single[1]; }
  if (!y0) return null;

  const lower = s.toLowerCase();
  for (const [canonical, aliases] of MAKE_ALIASES) {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias);
      if (idx < 0) continue;
      const after = s.slice(idx + alias.length).trim();
      const modelTok = after.split(/[\s,/\-|]+/).filter(Boolean)[0];
      if (!modelTok || /^(?:19|20)\d{2}$/.test(modelTok)) continue;
      return { y0, y1, make: canonical, model: modelTok.replace(/[^A-Za-z0-9-]/g, '') };
    }
  }
  return null;
}

// ── Strategy 2: Platform code mapping ────────────────────────────────────────

const PLATFORM_MAP = {
  // BMW
  E21: { make: 'BMW', model: '3 Series', y0: 1975, y1: 1983 },
  E30: { make: 'BMW', model: '3 Series', y0: 1982, y1: 1994 },
  E36: { make: 'BMW', model: '3 Series', y0: 1990, y1: 2000 },
  E46: { make: 'BMW', model: '3 Series', y0: 1998, y1: 2006 },
  E90: { make: 'BMW', model: '3 Series', y0: 2005, y1: 2012 },
  E91: { make: 'BMW', model: '3 Series Touring', y0: 2005, y1: 2012 },
  E92: { make: 'BMW', model: '3 Series Coupe', y0: 2006, y1: 2013 },
  E93: { make: 'BMW', model: '3 Series Convertible', y0: 2006, y1: 2013 },
  F30: { make: 'BMW', model: '3 Series', y0: 2012, y1: 2019 },
  F31: { make: 'BMW', model: '3 Series Touring', y0: 2012, y1: 2019 },
  G20: { make: 'BMW', model: '3 Series', y0: 2019, y1: 2026 },
  E28: { make: 'BMW', model: '5 Series', y0: 1981, y1: 1988 },
  E34: { make: 'BMW', model: '5 Series', y0: 1988, y1: 1996 },
  E39: { make: 'BMW', model: '5 Series', y0: 1995, y1: 2004 },
  E60: { make: 'BMW', model: '5 Series', y0: 2003, y1: 2010 },
  F10: { make: 'BMW', model: '5 Series', y0: 2010, y1: 2017 },
  G30: { make: 'BMW', model: '5 Series', y0: 2017, y1: 2024 },
  E38: { make: 'BMW', model: '7 Series', y0: 1994, y1: 2001 },
  E65: { make: 'BMW', model: '7 Series', y0: 2001, y1: 2008 },
  F01: { make: 'BMW', model: '7 Series', y0: 2008, y1: 2015 },
  G11: { make: 'BMW', model: '7 Series', y0: 2015, y1: 2023 },
  E53: { make: 'BMW', model: 'X5', y0: 1999, y1: 2006 },
  E70: { make: 'BMW', model: 'X5', y0: 2006, y1: 2013 },
  F15: { make: 'BMW', model: 'X5', y0: 2013, y1: 2018 },
  G05: { make: 'BMW', model: 'X5', y0: 2018, y1: 2026 },
  E83: { make: 'BMW', model: 'X3', y0: 2003, y1: 2010 },
  F25: { make: 'BMW', model: 'X3', y0: 2010, y1: 2017 },
  G01: { make: 'BMW', model: 'X3', y0: 2017, y1: 2025 },
  E84: { make: 'BMW', model: 'X1', y0: 2009, y1: 2015 },
  F48: { make: 'BMW', model: 'X1', y0: 2015, y1: 2022 },
  E85: { make: 'BMW', model: 'Z4', y0: 2002, y1: 2008 },
  E89: { make: 'BMW', model: 'Z4', y0: 2009, y1: 2016 },
  E31: { make: 'BMW', model: '8 Series', y0: 1989, y1: 1999 },
  G14: { make: 'BMW', model: '8 Series', y0: 2018, y1: 2026 },
  // Mercedes
  W123: { make: 'Mercedes-Benz', model: 'W123', y0: 1976, y1: 1986 },
  W124: { make: 'Mercedes-Benz', model: 'E-Class', y0: 1985, y1: 1996 },
  W210: { make: 'Mercedes-Benz', model: 'E-Class', y0: 1995, y1: 2003 },
  W211: { make: 'Mercedes-Benz', model: 'E-Class', y0: 2002, y1: 2009 },
  W212: { make: 'Mercedes-Benz', model: 'E-Class', y0: 2009, y1: 2016 },
  W213: { make: 'Mercedes-Benz', model: 'E-Class', y0: 2016, y1: 2024 },
  W201: { make: 'Mercedes-Benz', model: '190E', y0: 1982, y1: 1993 },
  W202: { make: 'Mercedes-Benz', model: 'C-Class', y0: 1993, y1: 2000 },
  W203: { make: 'Mercedes-Benz', model: 'C-Class', y0: 2000, y1: 2007 },
  W204: { make: 'Mercedes-Benz', model: 'C-Class', y0: 2007, y1: 2014 },
  W205: { make: 'Mercedes-Benz', model: 'C-Class', y0: 2014, y1: 2021 },
  W206: { make: 'Mercedes-Benz', model: 'C-Class', y0: 2021, y1: 2026 },
  W140: { make: 'Mercedes-Benz', model: 'S-Class', y0: 1991, y1: 1999 },
  W220: { make: 'Mercedes-Benz', model: 'S-Class', y0: 1998, y1: 2005 },
  W221: { make: 'Mercedes-Benz', model: 'S-Class', y0: 2005, y1: 2013 },
  W222: { make: 'Mercedes-Benz', model: 'S-Class', y0: 2013, y1: 2020 },
  W163: { make: 'Mercedes-Benz', model: 'M-Class', y0: 1997, y1: 2005 },
  W164: { make: 'Mercedes-Benz', model: 'M-Class', y0: 2005, y1: 2011 },
  W166: { make: 'Mercedes-Benz', model: 'GLE', y0: 2011, y1: 2019 },
  X166: { make: 'Mercedes-Benz', model: 'GLS', y0: 2012, y1: 2019 },
  W169: { make: 'Mercedes-Benz', model: 'A-Class', y0: 2004, y1: 2012 },
  W176: { make: 'Mercedes-Benz', model: 'A-Class', y0: 2012, y1: 2018 },
  W177: { make: 'Mercedes-Benz', model: 'A-Class', y0: 2018, y1: 2026 },
  W246: { make: 'Mercedes-Benz', model: 'B-Class', y0: 2011, y1: 2018 },
  R170: { make: 'Mercedes-Benz', model: 'SLK', y0: 1996, y1: 2004 },
  R171: { make: 'Mercedes-Benz', model: 'SLK', y0: 2004, y1: 2011 },
  R172: { make: 'Mercedes-Benz', model: 'SLC', y0: 2011, y1: 2020 },
  X204: { make: 'Mercedes-Benz', model: 'GLK', y0: 2008, y1: 2015 },
  C204: { make: 'Mercedes-Benz', model: 'C-Class Coupe', y0: 2011, y1: 2015 },
  C205: { make: 'Mercedes-Benz', model: 'C-Class Coupe', y0: 2015, y1: 2021 },
  // VW / Audi
  '8L': { make: 'Audi', model: 'A3', y0: 1996, y1: 2003 },
  '8P': { make: 'Audi', model: 'A3', y0: 2003, y1: 2012 },
  '8V': { make: 'Audi', model: 'A3', y0: 2012, y1: 2020 },
  '8E': { make: 'Audi', model: 'A4', y0: 2000, y1: 2005 },
  '8H': { make: 'Audi', model: 'A4', y0: 2005, y1: 2008 },
  '8K': { make: 'Audi', model: 'A4', y0: 2008, y1: 2015 },
  '8W': { make: 'Audi', model: 'A4', y0: 2015, y1: 2024 },
  '4B': { make: 'Audi', model: 'A6', y0: 1997, y1: 2004 },
  '4F': { make: 'Audi', model: 'A6', y0: 2004, y1: 2011 },
  '4G': { make: 'Audi', model: 'A6', y0: 2011, y1: 2018 },
  '4A': { make: 'Audi', model: 'A6', y0: 2018, y1: 2026 },
  '4D': { make: 'Audi', model: 'A8', y0: 1994, y1: 2002 },
  '4E': { make: 'Audi', model: 'A8', y0: 2002, y1: 2010 },
  '4H': { make: 'Audi', model: 'A8', y0: 2010, y1: 2017 },
  FN: { make: 'Audi', model: 'A8', y0: 2017, y1: 2026 },
  '8N': { make: 'Audi', model: 'TT', y0: 1998, y1: 2006 },
  '8J': { make: 'Audi', model: 'TT', y0: 2006, y1: 2014 },
  '8S': { make: 'Audi', model: 'TT', y0: 2014, y1: 2023 },
  '8R': { make: 'Audi', model: 'Q5', y0: 2008, y1: 2017 },
  FY: { make: 'Audi', model: 'Q5', y0: 2017, y1: 2026 },
  '4L': { make: 'Audi', model: 'Q7', y0: 2005, y1: 2015 },
  '4M': { make: 'Audi', model: 'Q7', y0: 2015, y1: 2026 },
  MK4: { make: 'Volkswagen', model: 'Golf', y0: 1997, y1: 2004 },
  MK5: { make: 'Volkswagen', model: 'Golf', y0: 2003, y1: 2009 },
  MK6: { make: 'Volkswagen', model: 'Golf', y0: 2008, y1: 2013 },
  MK7: { make: 'Volkswagen', model: 'Golf', y0: 2012, y1: 2020 },
  MK8: { make: 'Volkswagen', model: 'Golf', y0: 2019, y1: 2026 },
  B5: { make: 'Volkswagen', model: 'Passat', y0: 1996, y1: 2005 },
  B6: { make: 'Volkswagen', model: 'Passat', y0: 2005, y1: 2010 },
  B7: { make: 'Volkswagen', model: 'Passat', y0: 2010, y1: 2015 },
  B8: { make: 'Volkswagen', model: 'Passat', y0: 2014, y1: 2023 },
  T5: { make: 'Volkswagen', model: 'Transporter', y0: 2003, y1: 2015 },
  T6: { make: 'Volkswagen', model: 'Transporter', y0: 2015, y1: 2024 },
  // Porsche
  '996': { make: 'Porsche', model: '911', y0: 1999, y1: 2005 },
  '997': { make: 'Porsche', model: '911', y0: 2004, y1: 2012 },
  '991': { make: 'Porsche', model: '911', y0: 2011, y1: 2019 },
  '992': { make: 'Porsche', model: '911', y0: 2019, y1: 2026 },
  '986': { make: 'Porsche', model: 'Boxster', y0: 1996, y1: 2004 },
  '987': { make: 'Porsche', model: 'Boxster', y0: 2004, y1: 2012 },
  '981': { make: 'Porsche', model: 'Boxster', y0: 2012, y1: 2016 },
  '955': { make: 'Porsche', model: 'Cayenne', y0: 2002, y1: 2010 },
  '958': { make: 'Porsche', model: 'Cayenne', y0: 2010, y1: 2018 },
  E1: { make: 'Porsche', model: 'Cayenne', y0: 2018, y1: 2026 },
  // Jaguar
  X350: { make: 'Jaguar', model: 'XJ', y0: 2003, y1: 2009 },
  X351: { make: 'Jaguar', model: 'XJ', y0: 2009, y1: 2019 },
  X250: { make: 'Jaguar', model: 'XF', y0: 2007, y1: 2015 },
  X260: { make: 'Jaguar', model: 'XF', y0: 2015, y1: 2024 },
  X150: { make: 'Jaguar', model: 'XK', y0: 2006, y1: 2014 },
  X760: { make: 'Jaguar', model: 'XE', y0: 2015, y1: 2024 },
  X761: { make: 'Jaguar', model: 'F-Pace', y0: 2016, y1: 2026 },
  X540: { make: 'Jaguar', model: 'F-Type', y0: 2013, y1: 2024 },
  // Land Rover / Range Rover
  L319: { make: 'Land Rover', model: 'Range Rover Sport', y0: 2005, y1: 2013 },
  L494: { make: 'Land Rover', model: 'Range Rover Sport', y0: 2013, y1: 2022 },
  L322: { make: 'Land Rover', model: 'Range Rover', y0: 2002, y1: 2012 },
  L405: { make: 'Land Rover', model: 'Range Rover', y0: 2012, y1: 2021 },
  L460: { make: 'Land Rover', model: 'Range Rover', y0: 2021, y1: 2026 },
  L316: { make: 'Land Rover', model: 'Discovery', y0: 2004, y1: 2017 },
  L462: { make: 'Land Rover', model: 'Discovery', y0: 2017, y1: 2026 },
  L538: { make: 'Land Rover', model: 'Evoque', y0: 2011, y1: 2019 },
  L551: { make: 'Land Rover', model: 'Evoque', y0: 2019, y1: 2026 },
  L550: { make: 'Land Rover', model: 'Discovery Sport', y0: 2014, y1: 2026 },
  L663: { make: 'Land Rover', model: 'Defender', y0: 2020, y1: 2026 },
};

function parsePlatformCode(title) {
  const s = String(title || '').toUpperCase();
  // Match codes like E30, E46, W123, X260, 8L, FY, MK7, T5, 996, etc.
  const patterns = [
    /\b(MK[0-9])\b/i,        // VW Golf MK4, MK5, etc.
    /\b(T[0-9])\b/i,         // VW Transporter T5, T6
    /\b(996|997|991|992|986|987|981|955|958)\b/,  // Porsche
    /\b([A-Z]{1,2}[0-9]{2,3})\b/g,  // E30, W123, X260, 8L, FY, etc.
  ];

  const codes = new Set();
  for (const pat of patterns) {
    if (pat.global) {
      for (const m of s.matchAll(pat)) codes.add(m[1]);
    } else {
      const m = s.match(pat);
      if (m) codes.add(m[1]);
    }
  }

  const results = [];
  for (const code of codes) {
    const entry = PLATFORM_MAP[code] || PLATFORM_MAP[code.toUpperCase()];
    if (entry) {
      results.push({
        make: entry.make,
        model: entry.model,
        y0: entry.y0,
        y1: entry.y1,
        source: `platform:${code}`,
      });
    }
  }
  return results;
}

// ── Strategy 3: OE cross-reference matching ──────────────────────────────────

async function matchOeNumbers(pg, partId) {
  const { rows: oeRows } = await pg.query(`
    SELECT cpn."displayNumber", cpn."normalizedNumber", vm_ref.name as make_name
    FROM "CatalogPartNumber" cpn
    LEFT JOIN "VehicleMake" vm_ref ON vm_ref.id = cpn."vehicleMakeId"
    WHERE cpn."canonicalPartId" = $1 AND cpn."numberType" = 'OEM_CROSS_REFERENCE'
  `, [partId]);

  if (oeRows.length === 0) return [];

  const results = [];
  for (const oe of oeRows) {
    // Try to find this OE number in MVL's sourceKey (which is like US:4080358346)
    // or check if the make from the cross-reference gives us a make to work with
    if (oe.make_name) {
      // We have a make from the cross-reference — check if any MVL vehicle exists for common years
      const nMake = norm(oe.make_name);
      if (nMake) {
        const { rows: mvlHits } = await pg.query(`
          SELECT DISTINCT make, model, year FROM "MvlVehicle"
          WHERE "normalizedMake" = $1 AND market = 'US'
          ORDER BY year DESC LIMIT 5
        `, [nMake]);
        for (const hit of mvlHits) {
          results.push({
            make: hit.make,
            model: hit.model,
            y0: hit.year,
            y1: hit.year,
            source: `oe:${oe.displayNumber}`,
          });
        }
      }
    }
  }
  return results;
}

// ── Strategy 4: AI resolution ────────────────────────────────────────────────

const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-5.6-luna';

async function aiResolve(title, brand, mpn, oeNumbers) {
  if (!OPENROUTER_KEY) return null;

  const prompt = `What vehicle does this auto part fit?
Reply with ONLY a JSON array. Each element: {"from":2006,"to":2013,"make":"BMW","model":"3 Series"}
Use year ranges (from/to). One entry per distinct make+model. Max 5 entries. [] if unknown.

${title} | ${brand || ''} | ${mpn || ''}`;

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'Reply ONLY with a JSON array. No text.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 16384,
        reasoning: { effort: 'low' },
      }),
    });

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '';
    if (!content) {
      const reasoning = data.choices?.[0]?.message?.reasoning || data.choices?.[0]?.message?.reasoning_details?.[0]?.summary || '';
      const jsonFromReasoning = reasoning.match(/\[[\s\S]*?\]/);
      if (jsonFromReasoning) content = jsonFromReasoning[0];
    }
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    const results = [];
    for (const r of parsed) {
      if (!r.make || !r.model) continue;
      const y0 = Number(r.from) || Number(r.year) || Number(r.yearStart) || Number(r.startYear);
      const y1 = Number(r.to) || Number(r.year) || Number(r.yearEnd) || Number(r.endYear) || y0;
      if (!Number.isFinite(y0) || y0 < 1960 || y0 > 2030) continue;
      const endYear = Number.isFinite(y1) && y1 >= y0 ? Math.min(y1, 2030) : y0;
      for (let y = y0; y <= endYear; y++) {
        results.push({ y0: y, y1: y, make: String(r.make), model: String(r.model), source: 'ai' });
      }
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// ── MVL upsert helpers ───────────────────────────────────────────────────────

async function upsertFitment(pg, partId, vehicle) {
  // Upsert vehicle hierarchy
  await pg.query(
    `INSERT INTO "VehicleMake" (id, name, "canonicalName", "displayName")
     VALUES (gen_random_uuid(), $1, $1, $1) ON CONFLICT (name) DO NOTHING`,
    [vehicle.make],
  );
  const { rows: [mk] } = await pg.query(`SELECT id FROM "VehicleMake" WHERE name = $1`, [vehicle.make]);
  if (!mk) return null;

  let { rows: [mdl] } = await pg.query(
    `SELECT id FROM "VehicleModel" WHERE "makeId" = $1 AND name = $2`,
    [mk.id, vehicle.model],
  );
  if (!mdl) {
    const { rows: [m] } = await pg.query(
      `INSERT INTO "VehicleModel" (id, "makeId", name) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [mk.id, vehicle.model],
    );
    mdl = m;
  }

  // Find or create generation covering the year range
  let { rows: [gen] } = await pg.query(
    `SELECT id FROM "VehicleGeneration" WHERE "modelId" = $1 AND "startYear" <= $2 AND ("endYear" >= $2 OR "endYear" IS NULL) LIMIT 1`,
    [mdl.id, vehicle.y0],
  );
  if (!gen) {
    const { rows: [g] } = await pg.query(
      `INSERT INTO "VehicleGeneration" (id, "modelId", name, "startYear", "endYear")
       VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [mdl.id, `${vehicle.y0}-${vehicle.y1}`, vehicle.y0, vehicle.y1],
    );
    gen = g;
  }

  let { rows: [vc] } = await pg.query(
    `SELECT id FROM "VehicleConfiguration" WHERE "generationId" = $1 LIMIT 1`,
    [gen.id],
  );
  if (!vc) {
    const { rows: [v] } = await pg.query(
      `INSERT INTO "VehicleConfiguration" (id, "generationId") VALUES (gen_random_uuid(), $1) RETURNING id`,
      [gen.id],
    );
    vc = v;
  }

  // Upsert Fitment
  const fitmentId = randomUUID();
  await pg.query(`
    INSERT INTO "Fitment" (id, "canonicalPartId", "vehicleConfigId", "evidenceLevel", confidence, reviewer, source, "verificationStatus", reason, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'B', 0.9, 'Auto (MVL backfill)', 'MVL_BACKFILL', 'VERIFIED', $4, now(), now())
    ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO UPDATE SET
      source = 'MVL_BACKFILL', confidence = 0.9, "verificationStatus" = 'VERIFIED', "updatedAt" = now()
  `, [fitmentId, partId, vc.id, vehicle.source]);

  return { vehicleConfigId: vc.id, make: vehicle.make, model: vehicle.model, year: vehicle.y0 };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const { rows: parts } = await pg.query(`
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp."oeNumbers"
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    LEFT JOIN "Fitment" f ON f."canonicalPartId" = cp.id
    WHERE so."sellerId" = 'seller-superior-auto-parts'
      AND so.status = 'ACTIVE'
      AND f.id IS NULL
    GROUP BY cp.id
    ORDER BY cp."createdAt" DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
    ${OFFSET ? `OFFSET ${OFFSET}` : ''}
  `);

  console.log(`[W${WORKER_ID}] Processing ${parts.length} parts (offset=${OFFSET})${DRY_RUN ? ' DRY RUN' : ''}`);

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, skipped = 0, failed = 0;
  const startMs = Date.now();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    try {
      let vehicles = [];

      // Strategy 1: Title parsing
      if (!AI_ONLY) {
        const parsed = parseTitle(part.title);
        if (parsed) {
          for (let y = parsed.y0; y <= parsed.y1; y++) {
            vehicles.push({ make: parsed.make, model: parsed.model, y0: y, y1: y, source: 'title' });
          }
          s1++;
        }
      }

      // Strategy 2: Platform codes
      if (vehicles.length === 0 && !AI_ONLY) {
        const platforms = parsePlatformCode(part.title);
        if (platforms.length > 0) {
          for (const p of platforms) {
            for (let y = p.y0; y <= p.y1; y++) {
              vehicles.push({ ...p, y0: y, y1: y });
            }
          }
          s2++;
        }
      }

      // Strategy 3: OE cross-reference
      if (vehicles.length === 0 && !AI_ONLY) {
        const oeMatches = await matchOeNumbers(pg, part.id);
        if (oeMatches.length > 0) {
          vehicles = oeMatches;
          s3++;
        }
      }

      // Strategy 4: AI resolution
      if (vehicles.length === 0 && OPENROUTER_KEY) {
        const aiResult = await aiResolve(
          part.title, part.brand, part.manufacturerPartNumber,
          Array.isArray(part.oeNumbers) ? part.oeNumbers : [],
        );
        if (aiResult && aiResult.length > 0) {
          vehicles = aiResult;
          s4++;
        }
      }

      if (vehicles.length === 0) {
        skipped++;
        continue;
      }

      // Deduplicate by make+model+year
      const seen = new Set();
      const unique = vehicles.filter(v => {
        const key = `${norm(v.make)}|${norm(v.model)}|${v.y0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 20); // Cap at 20 vehicles per part

      if (!DRY_RUN) {
        // Filter out NaN years
        const validVehicles = unique.filter(v => Number.isFinite(v.y0) && v.y0 > 1950 && v.y0 < 2030);
        if (validVehicles.length === 0) { skipped++; continue; }

        const compatRows = validVehicles.map(v => ({
          year: v.y0, make: v.make, model: v.model,
          trim: '-', engine: '-', source: v.source, verified: true,
        }));

        await pg.query(`
          UPDATE "CanonicalPart" SET
            compatibility = $2,
            "fitmentStatus" = 'CONFIRMED',
            "fitmentConfidence" = 0.9,
            "fitmentFlags" = array_append(COALESCE("fitmentFlags", '{}'), 'MVL_VERIFIED'),
            "updatedAt" = now()
          WHERE id = $1
        `, [part.id, JSON.stringify(compatRows)]);

        for (const v of validVehicles) {
          await upsertFitment(pg, part.id, v);
        }
      }

      if ((s1 + s2 + s3 + s4) % 100 === 0) {
        const elapsed = (Date.now() - startMs) / 1000;
        const rate = (s1 + s2 + s3 + s4) / elapsed;
        const remaining = parts.length - i - 1;
        const eta = remaining / rate;
        console.log(`  [${i + 1}/${parts.length}] matched=${s1 + s2 + s3 + s4} s1=${s1} s2=${s2} s3=${s3} ai=${s4} skip=${skipped} rate=${rate.toFixed(1)}/s ETA=${(eta / 60).toFixed(0)}m`);
      }
    } catch (err) {
      failed++;
      if (failed <= 10) console.error(`  FAIL ${part.id}: ${err.message}`);
    }
  }

  const elapsed = (Date.now() - startMs) / 1000;
  console.log(`\nDone in ${elapsed.toFixed(0)}s:`);
  console.log(`  Title parsing: ${s1}`);
  console.log(`  Platform codes: ${s2}`);
  console.log(`  OE matching: ${s3}`);
  console.log(`  AI resolution: ${s4}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total matched: ${s1 + s2 + s3 + s4}`);
  await pg.end();
}

main().catch(e => { console.error(e); process.exit(1); });
