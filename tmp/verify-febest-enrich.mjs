import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const part = await prisma.canonicalPart.findFirst({
  where: { manufacturerPartNumber: '0101-ACA20F' },
  include: { media: true },
});

console.log(
  JSON.stringify(
    {
      id: part?.id,
      mpn: part?.manufacturerPartNumber,
      images: part?.imageUrls,
      media: part?.media?.length,
      listingUrl: part?.listingUrl,
      compatRows: Array.isArray(part?.compatibility) ? part.compatibility.length : null,
      sampleCompat: Array.isArray(part?.compatibility) ? part.compatibility.slice(0, 2) : null,
      oems: part?.oeNumbers,
      fitmentFlags: part?.fitmentFlags,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
