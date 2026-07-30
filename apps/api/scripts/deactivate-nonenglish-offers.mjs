// Deactivate SellerOffers whose canonical part title is non-English.
// Uses the SAME looksLikeEnglishTitle() as ingestion so cleanup matches the
// ingest-time filter exactly. Run after the API image is rebuilt so dist/
// contains the updated term list.
//
//   cd /app && node scripts/deactivate-nonenglish-offers.mjs
//   DRY_RUN=1 SAMPLE=40 node scripts/deactivate-nonenglish-offers.mjs
//
// DRY_RUN reports what would be hidden (with a title sample) and changes nothing.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DRY_RUN = process.env.DRY_RUN === '1';
const SAMPLE = Number(process.env.SAMPLE || 25);

async function loadLooksEnglish() {
  const candidates = [
    '/app/dist/src/modules/ingestion/listing-title.util.js',
    '/app/dist/apps/api/src/modules/ingestion/listing-title.util.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(pathToFileURL(resolve(p)).href);
      if (typeof mod.looksLikeEnglishTitle === 'function') return mod.looksLikeEnglishTitle;
    } catch {}
  }
  throw new Error('Could not load looksLikeEnglishTitle from dist — rebuild API first.');
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const looksLikeEnglishTitle = await loadLooksEnglish();
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const offers = await prisma.sellerOffer.findMany({
    where: { status: 'ACTIVE', seller: { onboardingStatus: 'ACTIVE' } },
    select: {
      id: true,
      canonicalPartId: true,
      canonicalPart: { select: { title: true } },
      seller: { select: { name: true } },
    },
  });

  const bySeller = {};
  const sampleTitles = [];
  const keptSample = [];
  const doomed = [];

  for (const o of offers) {
    const title = o.canonicalPart?.title || '';
    if (looksLikeEnglishTitle(title)) {
      if (keptSample.length < SAMPLE) keptSample.push(title);
      continue;
    }
    doomed.push(o);
    const name = o.seller?.name || '?';
    bySeller[name] = (bySeller[name] || 0) + 1;
    if (sampleTitles.length < SAMPLE) sampleTitles.push(title);
  }

  if (!DRY_RUN && doomed.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const ids = doomed.slice(i, i + CHUNK).map((o) => o.id);
      await prisma.sellerOffer.updateMany({
        where: { id: { in: ids } },
        data: { status: 'INACTIVE' },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        scanned: offers.length,
        deactivated: DRY_RUN ? 0 : doomed.length,
        wouldDeactivate: doomed.length,
        bySeller,
        sampleNonEnglish: sampleTitles,
        sampleKeptEnglish: keptSample,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
