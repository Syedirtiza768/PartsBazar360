/**
 * Lean MVL backfill — raw SQL, no Prisma, no stack overflow.
 * Matches parts to MVL by year/make/model from title, creates Fitment rows.
 *
 * Usage: node /tmp/mvl-backfill-lean.mjs [batch_size] [offset]
 */
import { Client as PgClient } from 'pg';

const BATCH = Number(process.argv[2]) || 500;
const OFFSET = Number(process.argv[3]) || 0;

function norm(s) {
  return String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '').trim();
}

function parseTitle(title) {
  const s = String(title || '');
  const range = s.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  const single = s.match(/\b((?:19|20)\d{2})\b/);
  let y0 = null, y1 = null;
  if (range) { y0 = +range[1]; y1 = +range[2]; }
  else if (single) { y0 = y1 = +single[1]; }
  if (!y0) return null;

  const lower = s.toLowerCase();
  const makes = [
    ['Toyota', 'toyota'], ['Honda', 'honda'], ['Nissan', 'nissan'], ['BMW', 'bmw'],
    ['Mercedes-Benz', 'mercedes'], ['Audi', 'audi'], ['Volkswagen', 'volkswagen'], ['VW', ' vw '],
    ['Ford', 'ford'], ['Chevrolet', 'chevrolet'], ['Chevy', 'chevy'], ['Hyundai', 'hyundai'],
    ['Kia', 'kia'], ['Mazda', 'mazda'], ['Subaru', 'subaru'], ['Lexus', 'lexus'],
    ['Infiniti', 'infiniti'], ['Acura', 'acura'], ['Porsche', 'porsche'], ['Jaguar', 'jaguar'],
    ['Land Rover', 'land rover'], ['Volvo', 'volvo'], ['Mini', 'mini'], ['MINI', 'mini'],
    ['Dodge', 'dodge'], ['Jeep', 'jeep'], ['GMC', 'gmc'], ['Cadillac', 'cadillac'],
    ['Buick', 'buick'], ['Chrysler', 'chrysler'], ['Lincoln', 'lincoln'], ['Ram', 'ram'],
    ['Mitsubishi', 'mitsubishi'], ['Suzuki', 'suzuki'], ['Isuzu', 'isuzu'], ['Fiat', 'fiat'],
    ['Maserati', 'maserati'], ['Bentley', 'bentley'], ['Rolls-Royce', 'rolls-royce'],
    ['Range Rover', 'range rover'], ['Tesla', 'tesla'],
  ];
  for (const [canonical, alias] of makes) {
    const idx = lower.indexOf(alias);
    if (idx < 0) continue;
    const after = s.slice(idx + alias.length).trim();
    const modelTok = after.split(/[\s,/\-|]+/).filter(Boolean)[0];
    if (!modelTok || /^(?:19|20)\d{2}$/.test(modelTok)) continue;
    return { y0, y1, make: canonical, model: modelTok.replace(/[^A-Za-z0-9-]/g, '') };
  }
  return null;
}

async function main() {
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // Get parts without fitment
  const { rows: parts } = await pg.query(`
    SELECT cp.id, cp.title, cp."manufacturerPartNumber"
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    LEFT JOIN "Fitment" f ON f."canonicalPartId" = cp.id
    WHERE so."sellerId" = 'seller-superior-auto-parts'
      AND so.status = 'ACTIVE'
      AND f.id IS NULL
    GROUP BY cp.id
    ORDER BY cp."createdAt" DESC
    LIMIT $1 OFFSET $2
  `, [BATCH, OFFSET]);

  console.log(`Processing ${parts.length} parts (offset=${OFFSET})`);

  let matched = 0, skipped = 0, failed = 0;

  for (const part of parts) {
    try {
      const parsed = parseTitle(part.title);
      if (!parsed) { skipped++; continue; }

      const nMake = norm(parsed.make);
      const candidates = [];
      // Try full model, then without trailing code, then first token
      const raw = parsed.model;
      candidates.push(raw);
      const without = raw.replace(/\s+[A-Z0-9#-]{1,8}$/i, '').trim();
      if (without && without.toLowerCase() !== raw.toLowerCase()) candidates.push(without);
      const first = raw.split(/\s+/)[0];
      if (first && !candidates.some(c => c.toLowerCase() === first.toLowerCase())) candidates.push(first);

      let hit = null;
      for (const variant of candidates) {
        const nModel = norm(variant);
        if (!nModel) continue;
        for (const year = parsed.y0; year <= parsed.y1; year++) {
          const { rows } = await pg.query(`
            SELECT make, model, trim, engine, epid, market
            FROM "MvlVehicle"
            WHERE year = $1 AND "normalizedMake" = $2 AND "normalizedModel" = $3
            LIMIT 1
          `, [year, nMake, nModel]);
          if (rows[0]) { hit = { ...rows[0], year }; break; }
        }
        if (hit) break;
      }
      if (!hit) { skipped++; continue; }

      // Upsert vehicle hierarchy
      await pg.query(`INSERT INTO "VehicleMake" (id, name, "canonicalName", "displayName") VALUES (gen_random_uuid(), $1, $1, $1) ON CONFLICT (name) DO NOTHING`, [hit.make]);
      const { rows: [mk] } = await pg.query(`SELECT id FROM "VehicleMake" WHERE name = $1`, [hit.make]);

      let { rows: [mdl] } = await pg.query(`SELECT id FROM "VehicleModel" WHERE "makeId" = $1 AND name = $2`, [mk.id, hit.model]);
      if (!mdl) {
        const { rows: [newMdl] } = await pg.query(`INSERT INTO "VehicleModel" (id, "makeId", name) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [mk.id, hit.model]);
        mdl = newMdl;
      }

      let { rows: [gen] } = await pg.query(`SELECT id FROM "VehicleGeneration" WHERE "modelId" = $1 AND "startYear" <= $2 AND ("endYear" >= $2 OR "endYear" IS NULL) LIMIT 1`, [mdl.id, hit.year]);
      if (!gen) {
        const { rows: [newGen] } = await pg.query(`INSERT INTO "VehicleGeneration" (id, "modelId", name, "startYear", "endYear") VALUES (gen_random_uuid(), $1, $2, $2, $2) RETURNING id`, [mdl.id, String(hit.year)]);
        gen = newGen;
      }

      let { rows: [vc] } = await pg.query(`SELECT id FROM "VehicleConfiguration" WHERE "generationId" = $1 AND trim IS NOT DISTINCT FROM $2 AND engine IS NOT DISTINCT FROM $3 LIMIT 1`, [gen.id, hit.trim, hit.engine]);
      if (!vc) {
        const { rows: [newVc] } = await pg.query(`INSERT INTO "VehicleConfiguration" (id, "generationId", trim, engine) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`, [gen.id, hit.trim, hit.engine]);
        vc = newVc;
      }

      // Upsert Fitment
      await pg.query(`
        INSERT INTO "Fitment" (id, "canonicalPartId", "vehicleConfigId", "evidenceLevel", confidence, reviewer, source, "verificationStatus", reason, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, 'B', 0.9, 'Auto (US MVL verified)', 'MVL_BACKFILL', 'VERIFIED', 'Matched US MVL Year/Make/Model', now(), now())
        ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO UPDATE SET
          source = 'MVL_BACKFILL', confidence = 0.9, "verificationStatus" = 'VERIFIED', "updatedAt" = now()
      `, [part.id, vc.id]);

      // Update CanonicalPart
      await pg.query(`
        UPDATE "CanonicalPart" SET
          "fitmentStatus" = 'CONFIRMED',
          "fitmentConfidence" = 0.9,
          "fitmentFlags" = array_append(COALESCE("fitmentFlags", '{}'), 'MVL_VERIFIED'),
          "updatedAt" = now()
        WHERE id = $1
      `, [part.id]);

      matched++;
      if (matched % 100 === 0) console.log(`  progress: matched=${matched} skipped=${skipped} failed=${failed}`);
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`  fail: ${part.id}: ${err.message}`);
    }
  }

  console.log(`Done: matched=${matched} skipped=${skipped} failed=${failed} (offset=${OFFSET})`);
  await pg.end();
}

main().catch(e => { console.error(e); process.exit(1); });
