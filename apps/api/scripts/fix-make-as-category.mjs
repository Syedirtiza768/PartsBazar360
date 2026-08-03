#!/usr/bin/env node
/**
 * Fix CanonicalParts whose category/categoryGroup is a vehicle make or truck
 * brand (e.g. "Mercedes-Benz", "Land Rover / Range Rover", "Truck - Volvo")
 * instead of a real part-system category. These came from catalog-import
 * batches (SCHNIEDER/HELLA/CONTINENTAL-VDO/etc.) whose title format the
 * original keyword categorizer never recognized, so it fell back to the
 * source vehicle brand as a fake "category".
 *
 * Many of these titles DO describe a real part ("SCHNIEDER Fuel Filter
 * R-Rover HSE III...", "GOOD RUBBER ARM BUSHING...") — those get correctly
 * reclassified via keyword matching into the existing 15-bucket taxonomy.
 * Titles with nothing to extract ("Unknown Part – E1912LI", "OEM Part –
 * 000 993 4607/SP") fall back to "General", same as any other unclassifiable
 * part — never left as a fake make-named category.
 *
 * Usage (inside API container / standalone container on the app network):
 *   node scripts/fix-make-as-category.mjs
 *   CONFIRM=1 node scripts/fix-make-as-category.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CONFIRM = process.env.CONFIRM === '1';
const BATCH = 500;

// Every value currently observed in category/categoryGroup that is a vehicle
// make or truck brand rather than a part-system category (from the live
// OpenSearch categoryGroup aggregation, 2026-08-03).
const MAKE_NAMED_CATEGORIES = [
  'Mercedes-Benz', 'Volkswagen', 'Truck - Mercedes-Benz', 'BMW', 'Toyota',
  'Truck - Volvo', 'Land Rover / Range Rover', 'Volkswagen / Audi', 'Hyundai',
  'Truck - MAN', 'Nissan', 'Truck', 'Truck - Scania', 'Honda', 'Porsche',
  'Kia', 'Isuzu', 'Truck - DAF', 'Mitsubishi', 'Mazda', 'Truck - Renault',
  'Opel', 'Jaguar', 'Daihatsu', 'Suzuki', 'Truck - BPW', 'Truck - IVECO',
  'Chrysler', 'Ford', 'Mini', 'Chevrolet / Daewoo', 'Dodge', 'GMC',
  'Chevrolet', 'Lexus', 'Bentley', 'Jeep', 'Peugeot', 'Truck - SINOTRUK',
  'Audi', 'Hyundai / Kia',
  // Long-tail stragglers found on a follow-up full-distribution check (each
  // 1-2 docs, too small to appear in the original top-60 sample).
  'Renault', 'Buick / Chevrolet / GMC', 'Cadillac', 'Cadillac / Chevrolet',
  'Citroen', 'Daewoo', 'Hino', 'Honda / Hyundai', 'Hyundai / Toyota',
  'Land Rover', 'Maserati', 'Mitsubishi / Toyota', 'Nissan / Toyota',
  'Peugeot / Citroen', 'Toyota / Daihatsu', 'Volvo / Kia',
];

// First match wins, so specific compound phrases are ordered before the
// generic single words they'd otherwise be swallowed by.
const CATEGORY_KEYWORD_MAP = [
  ['Fuel System', ['fuel filter', 'fuel pump', 'fuel injector', 'fuel tank', 'fuel line', 'carburetor']],
  ['Climate Control', ['ac filter', 'a/c filter', 'cabin filter', 'filter cabin', 'air conditioning', 'hvac', 'evaporator', 'blower motor', 'heater core', 'ac compressor']],
  ['Cooling', ['radiator', 'cooling fan', 'electric fan assy', 'electrical fan assembly', 'water pump', 'oil cooler', 'coolant', 'thermostat', 'outlet water', 'fan clutch', 'condenser', 'expansion tank', 'heat exchanger']],
  ['Brakes', ['brake disc', 'brake pad', 'brake shoe', 'brake caliper', 'brake booster', 'brake master cylinder', 'brake wear sensor', 'brake hose', 'brake valve', 'brake', 'caliper', 'rotor']],
  ['Suspension', ['susp control arm', 'susp tie rod', 'susp stabilizer', 'stabilizer link', 'stabiliser link', 'link stabiliser', 'link stabilizer', 'stabilizer bushing', 'stabilizer shaft', 'suspension bush', 'arm bushing', 'trailing arm', 'strut mounting', 'shock absorber', 'control arm', 'sway bar', 'ball joint', 'suspension'],],
  ['Steering', ['steering rack', 'power steering', 'tie rod end', 'idler arm', 'steering']],
  ['Lighting', ['headlight', 'head light', 'taillight', 'tail light', 'fog light', 'indicator lamp', 'bulb']],
  ['Electrical', ['starter motor', 'starter', 'alternator', 'ecu', 'wiring harness', 'wiring', 'sensor', 'battery', 'fuse box', 'ignition coil', 'spark plug']],
  ['Transmission', ['transmission', 'gearbox', 'differential', 'clutch', 'torque converter', 'driveshaft', 'cv joint', 'axle shaft', 'drive axle', 'half axle', 'cv axle']],
  ['Exhaust', ['exhaust manifold', 'exhaust', 'muffler', 'catalytic', 'silencer']],
  ['Engine', ['intake manifold', 'engine mounting', 'engine mount', 'air intake', 'intake hose', 'air filter', 'filter air', 'v-belt', 'timing belt', 'oil filter', 'oil pan', 'piston', 'crankshaft', 'camshaft', 'gasket', 'engine', 'motor']],
  ['Wheels', ['wheel bearing', 'hubcap', 'rim ', 'tire', 'tyre', 'wheel']],
  ['Interior', ['dashboard', 'console', 'airbag', 'seat', 'sun visor', 'armrest']],
  ['Body', ['bumper', 'fender', 'door ', 'hood', 'mirror', 'grille', 'panel', 'trunk', 'tailgate']],
];

function classify(title) {
  const lower = String(title ?? '').toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORD_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return 'General';
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const parts = await prisma.canonicalPart.findMany({
      where: { category: { in: MAKE_NAMED_CATEGORIES } },
      select: { id: true, title: true, category: true, categoryGroup: true },
    });
    console.log(`Found ${parts.length} parts with a make-named category`);

    const resolved = new Map(); // newCategory -> count
    const updates = []; // { id, category }
    for (const part of parts) {
      const category = classify(part.title);
      resolved.set(category, (resolved.get(category) || 0) + 1);
      updates.push({ id: part.id, category });
    }

    console.log('\n=== Reclassification breakdown ===');
    for (const [category, count] of [...resolved.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${category}: ${count}`);
    }

    const generalCount = resolved.get('General') || 0;
    console.log(`\nReclassified into a real category: ${parts.length - generalCount}`);
    console.log(`Fell back to General (non-descriptive title): ${generalCount}`);

    console.log('\nSample reclassifications:');
    for (const part of parts.slice(0, 15)) {
      const u = updates.find((x) => x.id === part.id);
      console.log(`  [${part.category} -> ${u.category}] ${part.title}`);
    }

    if (!CONFIRM) {
      console.log('\nDRY RUN — set CONFIRM=1 to apply. Nothing was changed.');
      return;
    }

    let updated = 0;
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      // Group by target category so each is a single updateMany, not N single updates.
      const byCategory = new Map();
      for (const u of slice) {
        if (!byCategory.has(u.category)) byCategory.set(u.category, []);
        byCategory.get(u.category).push(u.id);
      }
      for (const [category, ids] of byCategory) {
        await prisma.canonicalPart.updateMany({
          where: { id: { in: ids } },
          data: { category, categoryGroup: category },
        });
      }
      updated += slice.length;
      console.log(`  updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
    }

    console.log(`\nDone. Updated ${updated} parts.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
