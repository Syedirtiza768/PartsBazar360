/**
 * OE/MPN backfill: copy compatibility from verified parts to unverified parts
 * that share the same manufacturerPartNumber or have matching OE numbers.
 * 
 * All matching done in SQL — no in-memory compat maps.
 *
 *   node scripts/backfill-compat-from-oe.mjs
 *   OE_BATCH_SIZE=500 node scripts/backfill-compat-from-oe.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { randomUUID } from 'node:crypto';

const BATCH_SIZE = Number(process.env.OE_BATCH_SIZE || 500);
const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'canonical_parts';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const osUrl = process.env.OPENSEARCH_NODE || process.env.OPENSEARCH_URL || 'http://opensearch:9200';
  const os = new OpenSearchClient({ node: osUrl });

  console.log(JSON.stringify({ event: 'oe_backfill_start', batchSize: BATCH_SIZE }));

  let verified = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;
  let lastId = '';

  while (true) {
    const rows = await prisma.$queryRawUnsafe(`
      WITH candidates AS (
        SELECT
          u.id,
          u.title,
          u.brand,
          u."manufacturerPartNumber" AS mpn,
          u."oeNumbers",
          u."fitmentFlags",
          -- Strategy 1: direct MPN match
          v1.compatibility AS mpn_compat,
          -- Strategy 2: OE → verified MPN
          v2.compatibility AS oe_mpn_compat,
          -- Strategy 3: MPN → verified OE
          v3.compatibility AS mpn_oe_compat
        FROM "CanonicalPart" u
        -- Strategy 1: MPN == MPN
        LEFT JOIN LATERAL (
          SELECT v.compatibility
          FROM "CanonicalPart" v
          WHERE 'MVL_VERIFIED' = ANY(v."fitmentFlags")
            AND v."manufacturerPartNumber" IS NOT NULL
            AND v."manufacturerPartNumber" = u."manufacturerPartNumber"
            AND v.compatibility IS NOT NULL
            AND v.compatibility::text NOT IN ('null', '[]')
          LIMIT 1
        ) v1 ON TRUE
        -- Strategy 2: one of u.oeNumbers matches a verified MPN
        LEFT JOIN LATERAL (
          SELECT v.compatibility
          FROM "CanonicalPart" v
          WHERE 'MVL_VERIFIED' = ANY(v."fitmentFlags")
            AND v."manufacturerPartNumber" IS NOT NULL
            AND v."manufacturerPartNumber" = ANY(u."oeNumbers")
            AND v.compatibility IS NOT NULL
            AND v.compatibility::text NOT IN ('null', '[]')
          LIMIT 1
        ) v2 ON TRUE
        -- Strategy 3: u.MPN appears in a verified part's oeNumbers
        LEFT JOIN LATERAL (
          SELECT v.compatibility
          FROM "CanonicalPart" v
          WHERE 'MVL_VERIFIED' = ANY(v."fitmentFlags")
            AND v."oeNumbers" IS NOT NULL
            AND u."manufacturerPartNumber" = ANY(v."oeNumbers")
            AND v.compatibility IS NOT NULL
            AND v.compatibility::text NOT IN ('null', '[]')
          LIMIT 1
        ) v3 ON TRUE
        WHERE u.id > $1
          AND NOT ('MVL_VERIFIED' = ANY(u."fitmentFlags"))
          AND (
            v1.compatibility IS NOT NULL
            OR v2.compatibility IS NOT NULL
            OR v3.compatibility IS NOT NULL
          )
        ORDER BY u.id
        LIMIT $2
      )
      SELECT * FROM candidates
    `, lastId, BATCH_SIZE);

    if (rows.length === 0) break;

    lastId = rows[rows.length - 1].id;
    processed += rows.length;

    for (const part of rows) {
      try {
        let compat = null;
        let strategy = null;

        if (part.mpn_compat) {
          compat = part.mpn_compat;
          strategy = 'mpn';
        } else if (part.oe_mpn_compat) {
          compat = part.oe_mpn_compat;
          strategy = 'oe_to_mpn';
        } else if (part.mpn_oe_compat) {
          compat = part.mpn_oe_compat;
          strategy = 'mpn_to_oe';
        }

        if (!compat) { skipped++; continue; }

        const compatArr = Array.isArray(compat) ? compat : [];
        if (compatArr.length === 0) { skipped++; continue; }

        const existingFlags = Array.isArray(part.fitmentFlags) ? part.fitmentFlags : [];
        const newFlags = [...new Set([...existingFlags, 'MVL_VERIFIED', 'OE_CROSS_REF'])];

        await prisma.$queryRawUnsafe(`
          UPDATE "CanonicalPart" SET
            compatibility = $2::jsonb,
            "fitmentStatus" = 'CONFIRMED',
            "fitmentConfidence" = 0.85,
            "fitmentFlags" = $3::text[],
            "updatedAt" = now()
          WHERE id = $1
        `, part.id, JSON.stringify(compatArr), newFlags);

        const fitments = [];
        for (const row of compatArr) {
          if (!row.make || !row.model || !row.year) continue;
          try {
            await prisma.$queryRaw`INSERT INTO "VehicleMake" (id, name, "canonicalName", "displayName") VALUES (gen_random_uuid(), ${row.make}, ${row.make}, ${row.make}) ON CONFLICT (name) DO NOTHING`;
            const [mk] = await prisma.$queryRaw`SELECT id FROM "VehicleMake" WHERE name = ${row.make}`;
            if (!mk) continue;

            let [mdl] = await prisma.$queryRaw`SELECT id FROM "VehicleModel" WHERE "makeId" = ${mk.id} AND name = ${row.model}`;
            if (!mdl) {
              await prisma.$queryRaw`INSERT INTO "VehicleModel" (id, "makeId", name) VALUES (gen_random_uuid(), ${mk.id}, ${row.model})`;
              [mdl] = await prisma.$queryRaw`SELECT id FROM "VehicleModel" WHERE "makeId" = ${mk.id} AND name = ${row.model}`;
            }
            if (!mdl) continue;

            const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
            if (!Number.isFinite(year)) continue;

            let [gen] = await prisma.$queryRaw`SELECT id FROM "VehicleGeneration" WHERE "modelId" = ${mdl.id} AND "startYear" <= ${year} AND ("endYear" >= ${year} OR "endYear" IS NULL) LIMIT 1`;
            if (!gen) {
              await prisma.$queryRaw`INSERT INTO "VehicleGeneration" (id, "modelId", name, "startYear", "endYear") VALUES (gen_random_uuid(), ${mdl.id}, ${String(year)}, ${year}, ${year})`;
              [gen] = await prisma.$queryRaw`SELECT id FROM "VehicleGeneration" WHERE "modelId" = ${mdl.id} AND "startYear" <= ${year} AND "endYear" >= ${year} LIMIT 1`;
            }
            if (!gen) continue;

            let [vc] = await prisma.$queryRaw`SELECT id FROM "VehicleConfiguration" WHERE "generationId" = ${gen.id} LIMIT 1`;
            if (!vc) {
              await prisma.$queryRaw`INSERT INTO "VehicleConfiguration" (id, "generationId") VALUES (gen_random_uuid(), ${gen.id})`;
              [vc] = await prisma.$queryRaw`SELECT id FROM "VehicleConfiguration" WHERE "generationId" = ${gen.id} LIMIT 1`;
            }
            if (!vc) continue;

            const fid = randomUUID();
            await prisma.$queryRaw`
              INSERT INTO "Fitment" (id, "canonicalPartId", "vehicleConfigId", "evidenceLevel", confidence, reviewer, source, "verificationStatus", reason, "createdAt", "updatedAt")
              VALUES (${fid}, ${part.id}, ${vc.id}, 'C', 0.85, 'Auto (OE cross-ref)', 'OE_BACKFILL', 'VERIFIED', ${'OE/MPN: ' + strategy}, now(), now())
              ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO NOTHING
            `;
            fitments.push({ vehicleConfigId: vc.id });
          } catch { /* individual fitment failures non-fatal */ }
        }

        try {
          await os.update({
            index: INDEX_NAME,
            id: part.id,
            body: { doc: { compatibility: compatArr, fitments }, doc_as_upsert: true },
          });
        } catch { }

        verified++;
      } catch (err) {
        failed++;
        if (failed <= 20) console.error(JSON.stringify({ event: 'part_fail', id: part.id, error: String(err?.message || err) }));
      }
    }

    console.log(JSON.stringify({ event: 'batch_done', scanned: processed, verified, skipped, failed }));
  }

  console.log(JSON.stringify({ event: 'oe_backfill_done', scanned: processed, verified, skipped, failed }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
