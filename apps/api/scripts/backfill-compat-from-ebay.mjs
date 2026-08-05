/**
 * Fetch eBay compatibility via RealTrack Trading Enrichment for parts with ebayItemId
 * that don't have MVL_VERIFIED.
 *
 *   node scripts/backfill-compat-from-ebay.mjs
 *   EBAY_ENRICH_LIMIT=100 node scripts/backfill-compat-from-ebay.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { randomUUID } from 'node:crypto';

const BATCH_SIZE = Number(process.env.EBAY_ENRICH_BATCH || 100);
const DELAY_MS = Number(process.env.EBAY_ENRICH_DELAY || 300);
const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'canonical_parts';

const RT_URL = process.env.REALTRACK_API_URL || 'https://mhn.realtrackapp.com/api';
const RT_EMAIL = process.env.REALTRACK_API_EMAIL || 'api-published-listings@realtrack.local';
const RT_PASS = process.env.REALTRACK_API_PASSWORD;
if (!RT_PASS) throw new Error('REALTRACK_API_PASSWORD env var is required');

let rtToken = null;
let rtTokenExpiry = 0;

async function rtAuth() {
  if (rtToken && Date.now() < rtTokenExpiry) return rtToken;
  const res = await fetch(`${RT_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: RT_EMAIL, password: RT_PASS }),
  });
  if (!res.ok) throw new Error(`RealTrack auth failed: ${res.status}`);
  const data = await res.json();
  rtToken = data.accessToken;
  rtTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return rtToken;
}

async function rtFetch(path) {
  const token = await rtAuth();
  const res = await fetch(`${RT_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    rtToken = null;
    const token2 = await rtAuth();
    const res2 = await fetch(`${RT_URL}${path}`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    if (!res2.ok) throw new Error(`RealTrack ${res2.status}: ${await res2.text()}`);
    return res2.json();
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 10;
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return rtFetch(path);
  }
  if (!res.ok) throw new Error(`RealTrack ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalizeToken(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '').trim();
}

function normalizeCompatibility(raw) {
  if (!raw) return [];
  const rows = [];

  function pushRow(r) {
    if (!r.make && !r.model && !r.year) return;
    rows.push({
      year: r.year ?? '-',
      make: String(r.make || '-'),
      model: String(r.model || '-'),
      trim: r.trim ? String(r.trim) : '-',
      engine: r.engine ? String(r.engine) : '-',
      source: 'ebay_trading',
    });
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') continue;
      pushRow({
        year: item.year ?? item.Year ?? item.years,
        make: item.make ?? item.Make ?? item.brand,
        model: item.model ?? item.Model,
        trim: item.trim ?? item.Trim,
        engine: item.engine ?? item.Engine,
      });
    }
  } else if (typeof raw === 'object') {
    if (Array.isArray(raw.compatibleProducts)) {
      for (const product of raw.compatibleProducts) {
        const props = {};
        for (const p of product.compatibilityProperties || []) {
          if (p.name && p.value) props[p.name] = p.value;
        }
        const pf = product.productFamilyProperties || {};
        pushRow({
          year: props.Year || pf.year,
          make: props.Make || pf.make,
          model: props.Model || pf.model,
          trim: props.Trim || pf.trim,
          engine: props.Engine || pf.engine,
        });
      }
    }
    const list = raw.vehicles || raw.items || raw.compatibleVehicles;
    if (Array.isArray(list)) {
      for (const item of list) {
        pushRow({
          year: item.year ?? item.Year,
          make: item.make ?? item.Make,
          model: item.model ?? item.Model,
          trim: item.trim ?? item.Trim,
          engine: item.engine ?? item.Engine,
        });
      }
    }
  }
  return rows;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const osUrl = process.env.OPENSEARCH_NODE || process.env.OPENSEARCH_URL || 'http://opensearch:9200';
  const os = new OpenSearchClient({ node: osUrl });

  console.log(JSON.stringify({ event: 'ebay_enrich_start', batchSize: BATCH_SIZE, delayMs: DELAY_MS }));

  let verified = 0;
  let skipped = 0;
  let failed = 0;
  let noCompat = 0;
  let processed = 0;
  let lastId = '';

  while (true) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (cp.id)
        cp.id, cp.title, cp."ebayItemId", cp."manufacturerPartNumber",
             cp.compatibility AS existing_compat, cp."fitmentFlags",
             COALESCE(
               CASE WHEN so."externalOfferId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN so."externalOfferId" END,
               CASE WHEN so."sourceKey" ~ '^rt:[0-9a-f-]+:[0-9a-f-]{36}$'
                    THEN (regexp_match(so."sourceKey", '^rt:[0-9a-f-]+:([0-9a-f-]{36})$'))[1] END
             ) AS rt_listing_id
      FROM "CanonicalPart" cp
      JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id AND so.status = 'ACTIVE'
      WHERE cp.id > $1
        AND NOT ('MVL_VERIFIED' = ANY(cp."fitmentFlags"))
        AND (
          so."externalOfferId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR so."sourceKey" ~ '^rt:[0-9a-f-]+:[0-9a-f-]{36}$'
        )
      ORDER BY cp.id
      LIMIT $2
    `, lastId, BATCH_SIZE);

    if (rows.length === 0) break;

    lastId = rows[rows.length - 1].id;
    processed += rows.length;

    for (const part of rows) {
      try {
        const rtListingId = part.rt_listing_id;
        if (!rtListingId) { skipped++; continue; }
        const enrichment = await rtFetch(`/published-listings/${encodeURIComponent(rtListingId)}/trading-enrichment`);
        await new Promise(r => setTimeout(r, DELAY_MS));

        const rawCompat = enrichment?.compatibility ?? enrichment?.body?.compatibility ?? null;
        const compatRows = normalizeCompatibility(rawCompat);

        if (compatRows.length === 0) {
          noCompat++;
          continue;
        }

        const existingFlags = Array.isArray(part.fitmentFlags) ? part.fitmentFlags : [];
        const newFlags = [...new Set([...existingFlags, 'MVL_VERIFIED', 'EBAY_TRADING'])];

        await prisma.$queryRawUnsafe(`
          UPDATE "CanonicalPart" SET
            compatibility = $2::jsonb,
            "fitmentStatus" = 'CONFIRMED',
            "fitmentConfidence" = 0.88,
            "fitmentFlags" = $3::text[],
            "updatedAt" = now()
          WHERE id = $1
        `, part.id, JSON.stringify(compatRows), newFlags);

        const fitments = [];
        for (const row of compatRows) {
          if (!row.make || !row.model || row.make === '-' || row.model === '-') continue;
          const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
          if (!Number.isFinite(year)) continue;
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
              VALUES (${fid}, ${part.id}, ${vc.id}, 'B', 0.88, 'Auto (eBay Trading)', 'EBAY_TRADING_ENRICH', 'VERIFIED', 'eBay Trading API compatibility', now(), now())
              ON CONFLICT ("canonicalPartId", "vehicleConfigId") DO NOTHING
            `;
            fitments.push({ vehicleConfigId: vc.id });
          } catch { }
        }

        try {
          await os.update({
            index: INDEX_NAME,
            id: part.id,
            body: { doc: { compatibility: compatRows, fitments }, doc_as_upsert: true },
          });
        } catch { }

        verified++;
      } catch (err) {
        failed++;
        if (failed <= 20) console.error(JSON.stringify({ event: 'fail', id: part.id, error: String(err?.message || err) }));
      }
    }

    console.log(JSON.stringify({ event: 'batch_done', scanned: processed, verified, noCompat, skipped, failed }));
  }

  console.log(JSON.stringify({ event: 'ebay_enrich_done', scanned: processed, verified, noCompat, skipped, failed }));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
