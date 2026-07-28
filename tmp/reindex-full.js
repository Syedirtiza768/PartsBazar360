/**
 * Full reindex: clears OpenSearch and re-indexes all parts with offers.
 * Extracts `makes` from compatibility data for faceted filtering.
 * Run inside API container: node /app/reindex-full.js
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');
const { PrismaService } = require('./dist/src/prisma.service');
const { OpenSearchService } = require('./dist/src/modules/search/opensearch.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);
  const client = search['client'];

  console.log('Deleting OpenSearch index...');
  try {
    await client.indices.delete({ index: 'canonical_parts' });
    console.log('Index deleted.');
  } catch (e) {
    console.log('Delete failed (may not exist):', e.meta?.statusCode || e.message);
  }

  // Recreate index with correct mappings
  console.log('Creating index with makes field...');
  await client.indices.create({
    index: 'canonical_parts',
    body: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
          partType: { type: 'keyword' },
          brand: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 128 } } },
          manufacturerPartNumber: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 128 } } },
          category: { type: 'keyword' },
          makes: { type: 'keyword' },
          oeNumbers: { type: 'keyword' },
          imageUrls: { type: 'keyword' },
          partSource: { type: 'keyword' },
          qualityTier: { type: 'keyword' },
          fitmentStatus: { type: 'keyword' },
          minPrice: { type: 'float' },
          createdAt: { type: 'date' },
          fitments: { type: 'keyword' },
          offers: { type: 'nested' },
          normalizedPartNumbers: { type: 'keyword' },
          interchangePartNumbers: { type: 'keyword' },
        },
      },
    },
  });
  console.log('Index created.');

  const pageSize = 200;
  let cursor = null;
  let total = 0;
  let skipped = 0;

  while (true) {
    const query = {
      take: pageSize,
      orderBy: { id: 'asc' },
      include: {
        offers: { where: { status: 'ACTIVE' }, include: { seller: true, inventory: true } },
        partNumbers: true,
        fitments: {
          where: { evidenceLevel: { in: ['A', 'B'] }, confidence: { gte: 0.8 } },
          select: { vehicleConfigId: true, evidenceLevel: true, confidence: true },
        },
      },
    };
    if (cursor) {
      query.skip = 1;
      query.cursor = { id: cursor };
    }

    const parts = await prisma.canonicalPart.findMany(query);
    if (parts.length === 0) break;

    for (const part of parts) {
      cursor = part.id;
      if (part.offers.length === 0) { skipped++; continue; }

      const compat = part.compatibility;
      let makes = [];
      if (Array.isArray(compat)) {
        makes = [...new Set(compat.map(c => c.make).filter(Boolean))];
      }

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
        // Patch: also update the makes field that indexPart doesn't set
        await client.update({
          index: 'canonical_parts',
          id: part.id,
          body: { doc: { makes } },
        });
        total++;
      } catch (e) {
        // skip
      }
    }

    if (total % 1000 < pageSize) {
      console.log(`Indexed ${total} parts (skipped ${skipped} with no offers)...`);
    }
  }

  console.log(`Done! Reindexed ${total} parts (${skipped} skipped).`);
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
