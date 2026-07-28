/**
 * Re-index all parts into OpenSearch after brand cleanup.
 * Clears the index and re-indexes from the database.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./app.module');
const { PrismaService } = require('./prisma.service');
const { OpenSearchService } = require('./modules/search/opensearch.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);

  console.log('Clearing OpenSearch index...');
  try {
    await search['client'].delete_by_query({
      index: 'canonical_parts',
      body: { query: { match_all: {} } },
    });
    console.log('Index cleared.');
  } catch (e) {
    console.log('Clear failed (may be empty):', e.message);
  }

  const pageSize = 500;
  let page = 0;
  let total = 0;

  while (true) {
    const parts = await prisma.canonicalPart.findMany({
      skip: page * pageSize,
      take: pageSize,
      include: {
        offers: { where: { status: 'ACTIVE' }, include: { seller: true, inventory: true } },
        partNumbers: true,
        fitments: {
          where: { evidenceLevel: { in: ['A', 'B'] }, confidence: { gte: 0.8 } },
          select: { vehicleConfigId: true, evidenceLevel: true, confidence: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    if (parts.length === 0) break;

    for (const part of parts) {
      if (part.offers.length === 0) continue;
      try {
        await search.indexPart({
          id: part.id,
          title: part.title,
          brand: part.brand,
          category: part.category,
          partType: part.partType,
          manufacturerPartNumber: part.manufacturerPartNumber,
          oeNumbers: part.oeNumbers,
          imageUrls: part.imageUrls,
          listingUrl: part.listingUrl,
          ebayItemId: part.ebayItemId,
          compatibility: part.compatibility,
          partSource: part.partSource,
          qualityTier: part.qualityTier,
          fitmentStatus: part.fitmentStatus,
          fitmentConfidence: part.fitmentConfidence,
          createdAt: part.createdAt,
          partNumbers: part.partNumbers,
          fitments: part.fitments,
          offers: part.offers.map(o => ({
            id: o.id,
            price: o.price,
            currency: o.currency,
            condition: o.condition,
            partSource: o.partSource,
            qualityTier: o.qualityTier,
            sellerId: o.sellerId,
            sellerName: o.seller?.name,
          })),
        });
        total++;
      } catch (e) {
        // skip errors
      }
    }

    page++;
    console.log(`Indexed ${total} parts (page ${page})...`);
  }

  console.log(`Done! Re-indexed ${total} parts.`);
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
