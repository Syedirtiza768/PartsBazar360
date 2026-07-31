import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('Backfilling OpenSearch makes facet from fitments + compatibility...');

  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  const parts = await prisma.canonicalPart.findMany({
    include: {
      offers: { include: { seller: true } },
      partNumbers: true,
      fitments: {
        include: {
          vehicleConfig: {
            include: {
              generation: {
                include: {
                  model: {
                    include: { make: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  console.log(`Found ${parts.length} parts to process.`);

  let reindexed = 0;
  let skipped = 0;

  for (const part of parts) {
    const compatMakes = ((part.compatibility as any[]) || [])
      .map((c: any) => c.make)
      .filter(Boolean);

    const fitmentMakes = part.fitments
      .map((f: any) => f.vehicleConfig?.generation?.model?.make?.name)
      .filter(Boolean);

    const makes = [...new Set([...compatMakes, ...fitmentMakes])];

    await searchService.indexPart({
      id: part.id,
      title: part.title,
      partType: part.partType,
      brand: part.brand,
      manufacturerPartNumber: part.manufacturerPartNumber,
      partNumbers: part.partNumbers,
      category: part.category,
      oeNumbers: part.oeNumbers,
      imageUrls: part.imageUrls,
      listingUrl: part.listingUrl,
      ebayItemId: part.ebayItemId,
      compatibility: part.compatibility,
      makes,
      partSource: part.partSource,
      qualityTier: part.qualityTier,
      fitmentStatus: part.fitmentStatus,
      fitmentConfidence: part.fitmentConfidence,
      createdAt: part.createdAt,
      fitments: part.fitments.map((f: any) => ({
        vehicleConfigId: f.vehicleConfigId,
        evidenceLevel: f.evidenceLevel,
        confidence: f.confidence,
      })),
      offers: part.offers,
    });
    reindexed++;

    if (reindexed % 100 === 0) {
      console.log(`...${reindexed} parts reindexed so far`);
    }
  }

  console.log(`Done. Reindexed ${reindexed} parts, skipped ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
