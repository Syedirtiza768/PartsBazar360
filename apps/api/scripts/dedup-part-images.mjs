// Deduplicate imageUrls stored on every CanonicalPart row.
//
// Many records accumulate duplicate URLs from overlapping ingestion/ingestion-
// enrichment passes because each pass uses slightly different comparison logic.
// This script normalizes eBay CDN s-l size variants (e.g. /s-l500.jpg and
// /s-l1600.jpg are the same physical image) and collapses duplicates.
//
//   cd /app && node scripts/dedup-part-images.mjs
//   DRY_RUN=1 SAMPLE=10 node scripts/dedup-part-images.mjs
//
// DRY_RUN reports what would change and samples a few rows; it writes nothing.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DRY_RUN = process.env.DRY_RUN === '1';
const SAMPLE = Number(process.env.SAMPLE || 10);

/** Collapse eBay CDN s-l size variants to a canonical form for comparison. */
function normalizeImageUrl(url) {
  return url
    .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')
    .replace(/\/s-l\d+\?/i, '/s-l1600?')
    .trim()
    .toLowerCase();
}

/** Deduplicate while preserving the first occurrence's casing/order. */
function dedupeImages(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    const norm = normalizeImageUrl(url);
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(url.trim());
  }
  return result;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  console.log(`Scanning CanonicalParts for duplicate imageUrls…${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const batchSize = 500;
  let cursor = undefined;
  let totalScanned = 0;
  let totalChanged = 0;
  let totalImagesBefore = 0;
  let totalImagesAfter = 0;
  const samples = [];

  for (;;) {
    const batch = await prisma.canonicalPart.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, title: true, imageUrls: true },
    });

    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;

    for (const part of batch) {
      totalScanned++;
      const original = part.imageUrls || [];
      if (original.length < 2) continue;

      const deduped = dedupeImages(original);

      if (deduped.length < original.length) {
        totalChanged++;
        totalImagesBefore += original.length;
        totalImagesAfter += deduped.length;

        if (samples.length < SAMPLE) {
          samples.push({
            id: part.id,
            title: part.title,
            before: original.length,
            after: deduped.length,
            removed: original.length - deduped.length,
          });
        }

        if (!DRY_RUN) {
          await prisma.canonicalPart.update({
            where: { id: part.id },
            data: { imageUrls: deduped },
          });
        }
      }
    }

    process.stdout.write(`\r  Scanned ${totalScanned} parts, ${totalChanged} need dedup…`);
  }

  console.log(`\n\nDone. Scanned ${totalScanned} parts.`);
  console.log(`  Changed: ${totalChanged}`);
  console.log(`  Images before: ${totalImagesBefore}  →  after: ${totalImagesAfter}  (removed ${totalImagesBefore - totalImagesAfter})`);

  if (samples.length) {
    console.log(`\nSample changes:`);
    for (const s of samples) {
      console.log(`  ${s.title}  [${s.before} → ${s.after}, -${s.removed}]  (${s.id})`);
    }
  }

  if (DRY_RUN) console.log('\n[DRY RUN] No writes performed.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});