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
    phone: '+971501234567',
  };
  const address = { country: 'Australia', line1: '1 Test St' };

  function buildService(part: Record<string, unknown>) {
    const reserveStock = jest.fn().mockResolvedValue(true);
    const releaseStock = jest.fn().mockResolvedValue(undefined);

    const cart = {
      id: 'cart-1',
      items: [
        {
          id: 'cart-item-1',
          intendedVehicleConfigId: null,
          purchaseIntent: 'UNSPECIFIED',
          sellerOfferId: 'offer-1',
          quantity: 1,
          sellerOffer: {
            sellerId: 'seller-1',
            price: 1200,
            currency: 'AED',
            status: 'ACTIVE',
            inventory: [{ quantity: 10 }],
            canonicalPart: part,
            seller: { name: 'Test Seller', onboardingStatus: 'ACTIVE' },
          },
        },
      ],
    };

    let validationRow: any;
    const service = new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      { reserveStock, releaseStock } as any,
      { createMultiSellerOrder: jest.fn() } as any,
      new ShippingService(),
      { isConfigured: () => true, createCheckoutSession: jest.fn() } as any,
      { isConfigured: () => false, createCheckoutSession: jest.fn() } as any,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'buyer-1',
            customerId: 'customer-1',
            name: 'Test Buyer',
            phone: '+971501234567',
            phoneVerified: true,
          }),
          update: jest.fn(),
        },
        customer: {
          update: jest.fn().mockResolvedValue({ id: 'customer-1' }),
        },
        order: { findFirst: jest.fn().mockResolvedValue(null) },
        checkoutValidation: {
          create: jest.fn().mockImplementation(({ data }) => {
            validationRow = data;
            return data;
          }),
          findFirst: jest.fn().mockImplementation(() => validationRow),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any,
      { notifyOrderUpdated: jest.fn().mockResolvedValue(undefined) } as any,
      { trackEvent: jest.fn() } as any,
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

    const review = await service.validateCheckout('cart-1', address, 'AED');

    await expect(
      service.processCheckout('cart-1', buyer, address, 'AED', undefined, {
        idempotencyKey: 'freight-test',
        validationId: review.validationId,
        acknowledgedCartItemIds: review.requiredAcknowledgmentCartItemIds,
      }),
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

    const review = await service.validateCheckout('cart-1', address, 'AED');

    // Fails later (order creation is stubbed), but must get past validation and
    // reserve stock — proving the parcel was not rejected by the freight gate.
    await service
      .processCheckout('cart-1', buyer, address, 'AED', undefined, {
        idempotencyKey: 'parcel-test',
        validationId: review.validationId,
        acknowledgedCartItemIds: review.requiredAcknowledgmentCartItemIds,
      })
      .catch(() => undefined);

    expect(reserveStock).toHaveBeenCalledWith('cart-1', 'offer-1', 1, 10);
  });
});
