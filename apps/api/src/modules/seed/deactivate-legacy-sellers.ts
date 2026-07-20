import { PrismaService } from '../../prisma.service';
import { MARKETPLACE_SELLERS } from './marketplace-sellers.config';

/** Stable IDs + names for the three live marketplace stores. */
export function activeMarketplaceSellerIds() {
  return Object.values(MARKETPLACE_SELLERS).map((s) => s.id);
}

export function activeMarketplaceSellerNames() {
  return Object.values(MARKETPLACE_SELLERS).map((s) => s.name);
}

/**
 * Suspend every seller that is not Salvage / Blackline / Superior,
 * and set their offers to INACTIVE so they disappear from buyer search/PDP.
 */
export async function deactivateLegacySellers(prisma: PrismaService) {
  const keepIds = new Set(activeMarketplaceSellerIds());
  const keepNames = new Set(activeMarketplaceSellerNames());

  // Resolve actual DB ids for the three (may differ from stable seed ids if pre-existing).
  const keepSellers = await prisma.seller.findMany({
    where: {
      OR: [
        { id: { in: [...keepIds] } },
        { name: { in: [...keepNames] } },
        { storeId: { in: Object.values(MARKETPLACE_SELLERS).map((s) => s.storeId!).filter(Boolean) } },
      ],
    },
    select: { id: true, name: true, storeId: true },
  });
  const keepSellerIds = new Set(keepSellers.map((s) => s.id));

  const legacy = await prisma.seller.findMany({
    where: { id: { notIn: [...keepSellerIds] } },
    select: { id: true, name: true, onboardingStatus: true },
  });

  if (legacy.length === 0) {
    return { deactivatedSellers: 0, inactivatedOffers: 0, kept: keepSellers };
  }

  const legacyIds = legacy.map((s) => s.id);

  const sellerResult = await prisma.seller.updateMany({
    where: { id: { in: legacyIds } },
    data: {
      onboardingStatus: 'SUSPENDED',
      onboardingNotes: 'Deactivated: not part of initial 3-store marketplace (Salvage, Blackline, Superior)',
    },
  });

  const offerResult = await prisma.sellerOffer.updateMany({
    where: {
      sellerId: { in: legacyIds },
      status: { not: 'INACTIVE' },
    },
    data: { status: 'INACTIVE' },
  });

  // Ensure the three live sellers are ACTIVE
  await prisma.seller.updateMany({
    where: { id: { in: [...keepSellerIds] } },
    data: { onboardingStatus: 'ACTIVE', activatedAt: new Date(), onboardingNotes: null },
  });

  return {
    deactivatedSellers: sellerResult.count,
    inactivatedOffers: offerResult.count,
    kept: keepSellers,
    suspended: legacy.map((s) => ({ id: s.id, name: s.name })),
  };
}
