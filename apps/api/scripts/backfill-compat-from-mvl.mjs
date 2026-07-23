/**
 * Backfill compatibility + verified Fitment for ACTIVE marketplace parts via US MVL.
 *
 * Sources per part (in order):
 *  1. Existing compatibility JSON year/make/model rows
 *  2. Title-parsed vehicle year range
 *
 * FEBEST parts without website rows should be enriched via enrich:febest first.
 *
 *   node scripts/backfill-compat-from-mvl.mjs
 *   BACKFILL_LIMIT=100 node scripts/backfill-compat-from-mvl.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { randomUUID } from 'node:crypto';

const LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : null;
const ONLY_MISSING = process.env.BACKFILL_ONLY_MISSING !== '0';
const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'canonical_parts';

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function modelVariants(model) {
  const raw = String(model || '').trim();
  if (!raw) return [];
  const out = [raw];
  const without = raw.replace(/\s+[A-Z0-9#-]{1,8}$/i, '').trim();
  if (without && without.toLowerCase() !== raw.toLowerCase()) out.push(without);
  const first = raw.split(/\s+/)[0];
  if (first && !out.some((v) => v.toLowerCase() === first.toLowerCase())) out.push(first);
  return [...new Set(out)];
}

const MAKE_ALIASES = [
  ['Land Rover', ['Land Rover']],
  ['Mercedes-Benz', ['Mercedes-Benz', 'Mercedes Benz', 'Mercedes']],
  ['Volkswagen', ['Volkswagen', 'VW']],
  ['BMW', ['BMW']],
  ['Audi', ['Audi']],
  ['Ford', ['Ford']],
  ['Toyota', ['Toyota']],
  ['Honda', ['Honda']],
  ['Nissan', ['Nissan']],
  ['Mazda', ['Mazda']],
  ['Porsche', ['Porsche']],
  ['Jaguar', ['Jaguar']],
  ['Bentley', ['Bentley']],
  ['Mini', ['MINI', 'Mini']],
  ['Dodge', ['Dodge']],
  ['Chevrolet', ['Chevrolet', 'Chevy']],
  ['GMC', ['GMC']],
  ['Cadillac', ['Cadillac']],
  ['Jeep', ['Jeep']],
  ['Lexus', ['Lexus']],
  ['Hyundai', ['Hyundai']],
  ['Subaru', ['Subaru']],
  ['Volvo', ['Volvo']],
  ['Kia', ['Kia']],
  ['Ram', ['Ram']],
  ['Tesla', ['Tesla']],
  ['Infiniti', ['Infiniti', 'INFINITI']],
  ['Acura', ['Acura']],
  ['Lincoln', ['Lincoln']],
  ['Buick', ['Buick']],
  ['Chrysler', ['Chrysler']],
  ['Mitsubishi', ['Mitsubishi']],
  ['Suzuki', ['Suzuki']],
  ['Isuzu', ['Isuzu']],
  ['Fiat', ['Fiat']],
  ['Maserati', ['Maserati']],
  ['Ferrari', ['Ferrari']],
  ['Lamborghini', ['Lamborghini']],
  ['Rolls-Royce', ['Rolls-Royce', 'Rolls Royce']],
  ['Range Rover', ['Range Rover']],
];

function parseVehicleFromTitle(title) {
  const range = String(title || '').match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  const single = String(title || '').match(/\b((?:19|20)\d{2})\b/);
  let startYear = null;
  let endYear = null;
  if (range) {
    startYear = parseInt(range[1], 10);
    endYear = parseInt(range[2], 10);
  } else if (single) {
    startYear = endYear = parseInt(single[1], 10);
  }
  if (!startYear || !endYear) return null;

  const lower = String(title);
  for (const [canonical, aliases] of MAKE_ALIASES) {
    for (const alias of aliases) {
      const idx = lower.toLowerCase().indexOf(alias.toLowerCase());
      if (idx < 0) continue;
      const after = lower.slice(idx + alias.length).trim();
      const modelTok = after.split(/[\s,/\-|]+/).filter(Boolean)[0];
      if (!modelTok || /^(?:19|20)\d{2}$/.test(modelTok)) continue;
      return {
        startYear,
        endYear,
        make: canonical,
        model: modelTok.replace(/[^A-Za-z0-9-]/g, ''),
      };
    }
  }
  return null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const osUrl = process.env.OPENSEARCH_NODE || process.env.OPENSEARCH_URL || 'http://opensearch:9200';
  const os = new OpenSearchClient({ node: osUrl });

  const mvlCountRows = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "MvlVehicle"`;
  const mvlCount = mvlCountRows?.[0]?.n || 0;
  if (mvlCount === 0) throw new Error('MvlVehicle is empty — import MVL first');

  const where = {
    offers: { some: { status: 'ACTIVE' } },
  };

  let parts = await prisma.canonicalPart.findMany({
    where,
    select: {
      id: true,
      title: true,
      brand: true,
      compatibility: true,
      fitmentFlags: true,
      fitmentStatus: true,
      oeNumbers: true,
      imageUrls: true,
      listingUrl: true,
      ebayItemId: true,
      createdAt: true,
      _count: { select: { fitments: true } },
      offers: {
        where: { status: 'ACTIVE' },
        select: { id: true, price: true, condition: true, sellerId: true, seller: { select: { name: true } } },
        take: 5,
      },
    },
    take: LIMIT || undefined,
    orderBy: { updatedAt: 'desc' },
  });

  if (ONLY_MISSING) {
    parts = parts.filter((p) => {
      const compat = Array.isArray(p.compatibility) ? p.compatibility : [];
      const hasVerifiedFlag = (p.fitmentFlags || []).includes('MVL_VERIFIED');
      const hasCompat = compat.length > 0;
      return !hasVerifiedFlag || !hasCompat || p._count.fitments === 0 || p.fitmentStatus !== 'CONFIRMED';
    });
  }

  console.log(JSON.stringify({ event: 'backfill_start', parts: parts.length, mvlCount }));

  let verified = 0;
  let skipped = 0;
  let failed = 0;

  for (const part of parts) {
    try {
      const candidates = [];
      const compat = Array.isArray(part.compatibility) ? part.compatibility : [];
      for (const row of compat) {
        const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
        if (!Number.isFinite(year) || !row.make || !row.model || row.make === '-' || row.model === '-') continue;
        candidates.push({ year, make: String(row.make), model: String(row.model), trim: row.trim, engine: row.engine, source: row.source || 'existing' });
      }
      if (candidates.length === 0) {
        const parsed = parseVehicleFromTitle(part.title || '');
        if (parsed) {
          for (let y = parsed.startYear; y <= Math.min(parsed.endYear, parsed.startYear + 40); y++) {
            candidates.push({ year: y, make: parsed.make, model: parsed.model, source: 'title' });
          }
        }
      }
      if (candidates.length === 0) {
        skipped++;
        continue;
      }

      const verifiedRows = [];
      const configIds = [];
      const seen = new Set();

      for (const c of candidates) {
        const key = `${c.year}|${normalizeToken(c.make)}|${normalizeToken(c.model)}`;
        if (seen.has(key)) continue;
        let hit = null;
        const nMake = normalizeToken(c.make);
        for (const variant of modelVariants(c.model)) {
          const nModel = normalizeToken(variant);
          if (!nMake || !nModel) continue;
          for (const market of ['DE', 'UK', 'AU', 'US']) {
            const rows = await prisma.$queryRaw`
              SELECT make, model, epid, "kType", trim, engine, market
              FROM "MvlVehicle"
              WHERE year = ${c.year}
                AND "normalizedMake" = ${nMake}
                AND "normalizedModel" = ${nModel}
                AND market = ${market}
              LIMIT 1
            `;
            if (rows?.[0]) {
              hit = rows[0];
              break;
            }
          }
          if (hit) break;
        }
        if (!hit) continue;
        seen.add(key);
        verifiedRows.push({
          year: c.year,
          make: hit.make,
          model: hit.model,
          trim: c.trim && c.trim !== '-' ? c.trim : hit.trim || '-',
          engine: c.engine && c.engine !== '-' ? c.engine : hit.engine || '-',
          source: c.source || 'mvl',
          epid: hit.epid,
          verified: true,
        });

        const make = await prisma.vehicleMake.upsert({
          where: { name: hit.make },
          update: {},
          create: { name: hit.make, canonicalName: hit.make, displayName: hit.make },
        });
        let model = await prisma.vehicleModel.findFirst({ where: { makeId: make.id, name: hit.model } });
        if (!model) model = await prisma.vehicleModel.create({ data: { makeId: make.id, name: hit.model } });
        let generation = await prisma.vehicleGeneration.findFirst({
          where: { modelId: model.id, startYear: c.year, endYear: c.year },
        });
        if (!generation) {
          generation = await prisma.vehicleGeneration.create({
            data: { modelId: model.id, name: String(c.year), startYear: c.year, endYear: c.year },
          });
        }
        let config = await prisma.vehicleConfiguration.findFirst({
          where: { generationId: generation.id, market: hit.market || 'US' },
        });
        if (!config) {
          config = await prisma.vehicleConfiguration.create({
            data: {
              generationId: generation.id,
              market: hit.market || 'US',
              trim: hit.trim,
              engine: hit.engine,
            },
          });
        }
        configIds.push(config.id);
      }

      if (verifiedRows.length === 0) {
        skipped++;
        continue;
      }

      const fitments = [];
      for (const vehicleConfigId of [...new Set(configIds)]) {
        const fitment = await prisma.fitment.upsert({
          where: {
            canonicalPartId_vehicleConfigId: { canonicalPartId: part.id, vehicleConfigId },
          },
          update: {
            evidenceLevel: 'B',
            confidence: 0.9,
            reviewer: 'Auto (US MVL verified)',
            source: 'MVL_BACKFILL',
            verificationStatus: 'VERIFIED',
            reason: 'Matched US MVL Year/Make/Model',
          },
          create: {
            canonicalPartId: part.id,
            vehicleConfigId,
            evidenceLevel: 'B',
            confidence: 0.9,
            reviewer: 'Auto (US MVL verified)',
            source: 'MVL_BACKFILL',
            verificationStatus: 'VERIFIED',
            reason: 'Matched US MVL Year/Make/Model',
          },
        });
        fitments.push({ vehicleConfigId, evidenceLevel: 'B', confidence: 0.9 });
        await prisma.fitmentEvidence.create({
          data: {
            id: randomUUID(),
            fitmentId: fitment.id,
            evidenceType: 'MVL_MATCH',
            evidenceLevel: 'B',
            confidence: 0.9,
            source: 'MVL_BACKFILL',
            verifiedBy: 'Auto (US MVL verified)',
            verifiedAt: new Date(),
          },
        }).catch(() => undefined);
      }

      await prisma.canonicalPart.update({
        where: { id: part.id },
        data: {
          compatibility: verifiedRows,
          fitmentStatus: 'CONFIRMED',
          fitmentConfidence: 0.9,
          fitmentFlags: [...new Set([...(part.fitmentFlags || []), 'MVL_VERIFIED'])],
        },
      });

      try {
        await os.update({
          index: INDEX_NAME,
          id: part.id,
          body: {
            doc: {
              compatibility: verifiedRows,
              fitments,
            },
            doc_as_upsert: true,
          },
        });
      } catch {
        /* index may lag */
      }

      verified++;
      if (verified % 100 === 0) {
        console.log(JSON.stringify({ event: 'progress', verified, skipped, failed }));
      }
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ event: 'part_fail', id: part.id, error: String(err?.message || err) }));
    }
  }

  console.log(JSON.stringify({ event: 'backfill_done', verified, skipped, failed }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
