import { PrismaService } from '../../prisma.service';
import { MARKETPLACE_SELLERS } from './marketplace-sellers.config';

/**
 * Promote Superior spreadsheet offers from REVIEW → ACTIVE when in stock.
 * Buyers only see ACTIVE offers.
 */
export async function activateSuperiorInStockOffers(prisma: PrismaService) {
  const superior = await prisma.seller.findFirst({
    where: {
      OR: [
        { id: MARKETPLACE_SELLERS.superior.id },
        { name: MARKETPLACE_SELLERS.superior.name },
      ],
    },
    select: { id: true, name: true },
  });
  if (!superior) {
    return { sellerId: null, activated: 0, leftReview: 0 };
  }

  const offers = await prisma.sellerOffer.findMany({
    where: {
      sellerId: superior.id,
      status: { in: ['REVIEW', 'NEEDS_REVIEW'] },
    },
    select: {
      id: true,
      inventory: { select: { quantity: true } },
    },
  });

  const inStockIds = offers
    .filter((o) => o.inventory.reduce((sum, row) => sum + (row.quantity || 0), 0) > 0)
    .map((o) => o.id);

  let activated = 0;
  if (inStockIds.length > 0) {
    // Chunk updates to avoid huge IN lists
    const chunkSize = 1000;
    for (let i = 0; i < inStockIds.length; i += chunkSize) {
      const chunk = inStockIds.slice(i, i + chunkSize);
      const result = await prisma.sellerOffer.updateMany({
        where: { id: { in: chunk } },
        data: { status: 'ACTIVE' },
      });
      activated += result.count;
    }
  }

  const leftReview = await prisma.sellerOffer.count({
    where: {
      sellerId: superior.id,
      status: { in: ['REVIEW', 'NEEDS_REVIEW'] },
    },
  });

  await prisma.sellerUploadJob.updateMany({
    where: {
      sellerId: superior.id,
      status: 'NEEDS_REVIEW',
    },
    data: { status: 'COMPLETED' },
  });

  return { sellerId: superior.id, sellerName: superior.name, activated, leftReview };
}
