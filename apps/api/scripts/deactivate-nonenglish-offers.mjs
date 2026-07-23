// Deactivate SellerOffers whose canonical part title is non-English.
// Uses the SAME looksLikeEnglishTitle() as ingestion so cleanup matches the
// ingest-time filter exactly. Run after the API image is rebuilt so dist/
// contains the updated term list.
//
//   cd /app && node scripts/deactivate-nonenglish-offers.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

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
    select: { id: true, canonicalPart: { select: { title: true } }, seller: { select: { name: true } } },
  });
  let deactivated = 0;
  const bySeller = {};
  for (const o of offers) {
    const title = o.canonicalPart?.title || '';
    if (!looksLikeEnglishTitle(title)) {
      await prisma.sellerOffer.update({ where: { id: o.id }, data: { status: 'INACTIVE' } });
      deactivated++;
      const name = o.seller?.name || '?';
      bySeller[name] = (bySeller[name] || 0) + 1;
    }
  }
  console.log(JSON.stringify({ deactivated, bySeller, scanned: offers.length }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
