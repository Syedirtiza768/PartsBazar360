#!/usr/bin/env node
/**
 * Diagnose one OpenSearch mapper_parsing_exception for a known part id.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const OS = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const INDEX = process.env.INDEX || 'canonical_parts';
const ID = process.env.PART_ID || 'd3a26a79-ec9c-4d24-8392-abac528c54f2';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const part = await prisma.canonicalPart.findUnique({
  where: { id: ID },
  include: {
    partNumbers: true,
    fitments: true,
    offers: {
      where: { status: 'ACTIVE', seller: { onboardingStatus: 'ACTIVE' } },
      include: { seller: true },
    },
  },
});

const body = {
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
  partSource: part.partSource,
  qualityTier: part.qualityTier,
  fitmentStatus: part.fitmentStatus,
  fitmentConfidence: part.fitmentConfidence,
  createdAt: part.createdAt.toISOString(),
  minPrice: part.offers[0]?.price ?? null,
  fitments: part.fitments.map((f) => f.vehicleConfigId),
  offers: part.offers.map((o) => ({
    id: o.id,
    price: o.price,
    currency: o.currency,
    condition: o.condition,
    partSource: o.partSource,
    qualityTier: o.qualityTier,
    sellerId: o.sellerId,
    sellerName: o.seller?.name || null,
  })),
};

const res = await fetch(`${OS}/${INDEX}/_doc/${ID}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('status', res.status);
console.log(text.slice(0, 2000));
console.log('compatibility type', typeof part.compatibility, Array.isArray(part.compatibility));
console.log('compatibility sample', JSON.stringify(part.compatibility)?.slice(0, 400));
console.log('partNumbers sample', JSON.stringify(part.partNumbers?.[0]));
await prisma.$disconnect();
