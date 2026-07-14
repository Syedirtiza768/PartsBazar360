import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('Backfilling imageUrls for previously-ingested real listings...');

  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  const offers = await prisma.sellerOffer.findMany({
    where: { externalOfferId: { not: null } },
    include: { canonicalPart: { include: { fitments: true, offers: true } } },
  });

  let updated = 0;
  let reindexed = 0;

  for (const offer of offers) {
    const part = offer.canonicalPart;
    if (!part || part.imageUrls.length > 0) {
      continue; // already has images (or no part) — skip
    }

    const raw = await prisma.rawStagingListing.findUnique({
      where: { sourceListingId: offer.externalOfferId! },
    });

    const imageUrls: string[] = Array.isArray((raw?.rawPayload as any)?.imageUrls)
      ? (raw!.rawPayload as any).imageUrls
      : [];

    if (imageUrls.length === 0) continue;

    const updatedPart = await prisma.canonicalPart.update({
      where: { id: part.id },
      data: { imageUrls },
      include: { fitments: true, offers: true },
    });
    updated++;

    await searchService.indexPart({
      id: updatedPart.id,
      title: updatedPart.title,
      brand: updatedPart.brand,
      category: updatedPart.category,
      oeNumbers: updatedPart.oeNumbers,
      imageUrls: updatedPart.imageUrls,
      createdAt: updatedPart.createdAt,
      fitments: updatedPart.fitments,
      offers: updatedPart.offers,
    });
    reindexed++;

    if (reindexed % 100 === 0) {
      console.log(`...${reindexed} parts backfilled so far`);
    }
  }

  console.log(`Done. Updated ${updated} parts with real images and reindexed ${reindexed} into OpenSearch.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
