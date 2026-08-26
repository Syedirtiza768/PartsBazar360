import type { PrismaService } from '../../prisma.service';

export const SEEDED_DISCOUNT_COUPONS = [
  { code: 'PBAUG26', discountPercent: 20 },
  { code: 'PBSEP26', discountPercent: 20 },
] as const;

/** Repeatable seed for the buyer-facing promotional coupons. */
export async function seedDiscountCoupons(prisma: PrismaService) {
  return Promise.all(
    SEEDED_DISCOUNT_COUPONS.map((coupon) =>
      prisma.discountCoupon.upsert({
        where: { code: coupon.code },
        update: {
          discountPercent: coupon.discountPercent,
          active: true,
          startsAt: null,
          endsAt: null,
        },
        create: {
          code: coupon.code,
          discountPercent: coupon.discountPercent,
          active: true,
        },
      }),
    ),
  );
}
