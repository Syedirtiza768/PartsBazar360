import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { ShippingService } from './shipping.service';

/**
 * Guards the freight gate in processCheckout: an over-ceiling cart must be
 * rejected before any stock is reserved, so a failed checkout does not hold
 * inventory until its Redis TTL expires.
 */
describe('CheckoutService freight gate', () => {
  const buyer = {
    buyerId: 'buyer-1',
    email: 'buyer@example.com',
    name: 'Test Buyer',
  };
  const address = { country: 'Australia', line1: '1 Test St' };

  function buildService(part: Record<string, unknown>) {
    const reserveStock = jest.fn().mockResolvedValue(true);
    const releaseStock = jest.fn().mockResolvedValue(undefined);

    const cart = {
      id: 'cart-1',
      items: [
        {
          sellerOfferId: 'offer-1',
          quantity: 1,
          sellerOffer: {
            sellerId: 'seller-1',
            price: 1200,
            currency: 'AED',
            canonicalPart: part,
            seller: { name: 'Test Seller' },
          },
        },
      ],
    };

    const service = new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      { reserveStock, releaseStock } as any,
      { createMultiSellerOrder: jest.fn() } as any,
      new ShippingService(),
      { isConfigured: () => true, createCheckoutSession: jest.fn() } as any,
      {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'buyer-1', name: 'Test Buyer' }) },
      } as any,
    );

    return { service, reserveStock, releaseStock };
  }

  it('rejects an over-ceiling cart without reserving stock', async () => {
    const { service, reserveStock } = buildService({
      id: 'part-1',
      title: 'Complete Engine Assembly for Ford F-150 5.0L',
      category: 'Engine',
      weight: 184,
      weightSource: 'MEASURED',
      partClassKey: 'ENGINE_ASSEMBLY',
      dimensions: null,
    });

    await expect(
      service.processCheckout('cart-1', buyer, address, 'AED'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.processCheckout('cart-1', buyer, address, 'AED'),
    ).rejects.toThrow(/freight quote/i);

    expect(reserveStock).not.toHaveBeenCalled();
  });

  it('does not gate a normal courier parcel', async () => {
    const { service, reserveStock } = buildService({
      id: 'part-2',
      title: 'Front Brake Pad Set for BMW 3 Series',
      category: 'Brakes',
      weight: 1.6,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BRAKE_PAD_SET',
      dimensions: { lengthCm: 22, widthCm: 14, heightCm: 8 },
    });

    // Fails later (order creation is stubbed), but must get past the gate and
    // reserve stock — proving the freight check did not reject it.
    await service
      .processCheckout('cart-1', buyer, address, 'AED')
      .catch(() => undefined);

    expect(reserveStock).toHaveBeenCalledWith('cart-1', 'offer-1', 1);
  });
});
