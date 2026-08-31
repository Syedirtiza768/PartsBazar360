import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

describe('CheckoutService coupons', () => {
  const cart = {
    id: 'cart-1',
    items: [
      {
        quantity: 2,
        sellerOffer: { price: 100, currency: 'AED' },
      },
    ],
  };

  function buildService(coupon: Record<string, unknown> | null) {
    return new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        discountCoupon: { findUnique: jest.fn().mockResolvedValue(coupon) },
      } as any,
      { notifyOrderUpdated: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
  }

  it('returns the entered coupon and 20% item-subtotal discount', async () => {
    const service = buildService({
      id: 'coupon-1',
      code: 'PBAUG26',
      discountPercent: 20,
      active: true,
      startsAt: null,
      endsAt: null,
    });

    await expect(
      service.quoteCoupon('cart-1', ' pbaug26 ', 'AED'),
    ).resolves.toMatchObject({
      code: 'PBAUG26',
      discountPercent: 20,
      subtotal: 200,
      discountAmount: 40,
      discountedSubtotal: 160,
      currency: 'AED',
    });
  });

  it('rejects inactive coupons', async () => {
    const service = buildService({
      id: 'coupon-1',
      code: 'PBSEP26',
      discountPercent: 20,
      active: false,
      startsAt: null,
      endsAt: null,
    });

    await expect(
      service.quoteCoupon('cart-1', 'PBSEP26', 'AED'),
    ).rejects.toThrow(BadRequestException);
  });
});
