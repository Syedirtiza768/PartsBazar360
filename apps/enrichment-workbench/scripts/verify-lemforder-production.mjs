import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const counts = await prisma.$queryRawUnsafe(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE title ILIKE '%fitment not verified%' OR title ILIKE '%fitment not confirmed%' OR title ILIKE '%fitment not available%')::int AS prohibited_titles,
      count(*) FILTER (WHERE "fitmentStatus" = 'CONFIRMED')::int AS confirmed,
      count(*) FILTER (WHERE "fitmentStatus" = 'NEEDS_REVIEW')::int AS needs_review,
      count(*) FILTER (WHERE compatibility IS NULL OR jsonb_array_length(compatibility) = 0)::int AS empty_compatibility,
      count(*) FILTER (WHERE 'FCPEURO_TRUSTED_SOURCE' = ANY("fitmentFlags"))::int AS trusted_source_parts,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Fitment" f WHERE f."canonicalPartId" = "CanonicalPart".id))::int AS parts_with_fitment_rows,
      (SELECT count(*)::int FROM "Fitment" f JOIN "CanonicalPart" c ON c.id = f."canonicalPartId" WHERE upper(trim(c.brand)) = 'LEMFORDER') AS fitment_rows
    FROM "CanonicalPart"
    WHERE upper(trim(brand)) = 'LEMFORDER'
      AND EXISTS (SELECT 1 FROM "SellerOffer" so WHERE so."canonicalPartId" = "CanonicalPart".id AND so.status = 'ACTIVE' AND so."sellerId" = 'seller-superior-auto-parts');
  `);

  const samples = await prisma.$queryRawUnsafe(`
    SELECT "manufacturerPartNumber" AS mpn, title, "fitmentStatus", "fitmentConfidence", jsonb_array_length(COALESCE(compatibility, '[]'::jsonb)) AS compatibility_rows
    FROM "CanonicalPart"
    WHERE upper(trim(brand)) = 'LEMFORDER'
      AND regexp_replace(upper("manufacturerPartNumber"), '[^A-Z0-9]', '', 'g') IN ('4282701', '3755701', '4235701')
    ORDER BY "manufacturerPartNumber";
  `);
  const outbox = await prisma.$queryRawUnsafe(`SELECT status, count(*)::int AS count FROM "SearchOutbox" WHERE "entityType" = 'CanonicalPart' AND "entityId" IN (SELECT id FROM "CanonicalPart" WHERE upper(trim(brand)) = 'LEMFORDER') GROUP BY status ORDER BY status`);
  console.log(JSON.stringify({ counts, samples, outbox }));
} finally {
  await prisma.$disconnect();
}
