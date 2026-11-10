import { ConflictException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

describe('CheckoutService per-line validation', () => {
  const cart = {
    id: 'cart-1',
    items: [
      {
        id: 'cart-item-1',
        sellerOfferId: 'offer-1',
        quantity: 1,
        intendedVehicleConfigId: 'vehicle-1',
        purchaseIntent: 'VEHICLE_FITMENT',
        sellerOffer: {
          id: 'offer-1',
          sellerId: 'seller-1',
          canonicalPartId: 'part-1',
          status: 'ACTIVE',
          price: 100,
          currency: 'AED',
          condition: 'NEW',
          updatedAt: new Date('2026-10-08T10:00:00.000Z'),
          inventory: [{ quantity: 4 }],
          seller: { onboardingStatus: 'ACTIVE' },
          canonicalPart: {
            id: 'part-1',
            title: 'Brake Pad',
            updatedAt: new Date('2026-10-08T09:00:00.000Z'),
          },
        },
      },
    ],
  };

  function buildService(fitment: Record<string, unknown>) {
    const createValidation = jest.fn().mockResolvedValue({});
    const shippingQuote = {
      available: true,
      availabilityReason: null,
      requiresFreightQuote: false,
      amount: 20,
      quotedWeightKg: 1,
      destinationCountry: 'UAE',
      serviceType: 'LOCAL',
      leadTime: '2-4 business days',
      billableWeightGrams: 1000,
      weightBasis: 'ACTUAL',
      weightSource: 'MEASURED',
      estimated: false,
      marginPct: 0,
    };
    const prisma = {
      fitment: { findMany: jest.fn().mockResolvedValue([fitment]) },
      checkoutValidation: { create: createValidation },
    };
    const service = new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      {} as any,
      {} as any,
      { quoteSellerShipping: jest.fn().mockReturnValue(shippingQuote) } as any,
      {} as any,
      {} as any,
      prisma as any,
      {} as any,
      {} as any,
    );
    return { service, createValidation };
  }

  const baseFitment = {
    id: 'fitment-1',
    canonicalPartId: 'part-1',
    vehicleConfigId: 'vehicle-1',
    evidenceLevel: 'B',
    confidence: 0.99,
    source: 'TITLE_MVL',
    verificationStatus: 'VERIFIED',
    updatedAt: new Date('2026-10-08T12:00:00.000Z'),
  };

  it('requires acknowledgment for title/MVL identity evidence and masks its provenance', async () => {
    const { service, createValidation } = buildService(baseFitment);

    const result = await service.validateCheckout(
      'cart-1',
      { country: 'UAE', city: 'Dubai', postalCode: '00000' },
      'AED',
      'stripe',
    );

    expect(result.lines).toMatchObject([
      {
        cartItemId: 'cart-item-1',
        fitmentStatus: 'UNVERIFIED',
        requiresAcknowledgment: true,
      },
    ]);
    expect(result.requiredAcknowledgmentCartItemIds).toEqual(['cart-item-1']);
    expect(JSON.stringify(result)).not.toContain('TITLE_MVL');
    expect(createValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cartId: 'cart-1',
          snapshot: expect.objectContaining({
            lines: [expect.objectContaining({ source: 'TITLE_MVL' })],
          }),
        }),
      }),
    );
  });

  it('allows a confirmed exact fitment without a redundant acknowledgment', async () => {
    const { service } = buildService({
      ...baseFitment,
      source: 'OEM_CATALOG_EXACT_FITMENT',
    });

    const result = await service.validateCheckout(
      'cart-1',
      { country: 'UAE', city: 'Dubai' },
      'AED',
      'stripe',
    );

    expect(result.lines[0]).toMatchObject({
      fitmentStatus: 'CONFIRMED',
      requiresAcknowledgment: false,
    });
    expect(result.requiredAcknowledgmentCartItemIds).toEqual([]);
  });

  it('blocks explicit fitment conflicts even when the evidence source is otherwise qualified', async () => {
    const { service } = buildService({
      ...baseFitment,
      source: 'OEM_CATALOG_EXACT_FITMENT',
      verificationStatus: 'CONFLICT',
    });

    const result = await service.validateCheckout(
      'cart-1',
      { country: 'UAE', city: 'Dubai' },
      'AED',
      'stripe',
    );

    expect(result.lines[0]).toMatchObject({
      fitmentStatus: 'CONFLICT',
      blockingReason: 'FITMENT_CONFLICT',
    });
    expect(result.blockingLineIds).toEqual(['cart-item-1']);
    expect(result.requiredAcknowledgmentCartItemIds).toEqual([]);
  });

  it('rejects a validation when current cart policy produces a different fingerprint', async () => {
    const validation = {
      id: 'validation-1',
      cartId: 'cart-1',
      checkoutSessionId: null,
      fingerprint: 'old-fingerprint',
      snapshot: {
        requiredAcknowledgmentCartItemIds: [],
        blockingLineIds: [],
        lines: [],
      },
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const service = new CheckoutService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        checkoutValidation: {
          findFirst: jest.fn().mockResolvedValue(validation),
        },
      } as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'evaluateCheckoutCart').mockResolvedValue({
      fingerprint: 'new-fingerprint',
      snapshot: {},
    });

    await expect(
      (service as any).requireCheckoutValidation({
        cart,
        cartId: 'cart-1',
        validationId: 'validation-1',
        shippingAddress: { country: 'UAE' },
        destinationCountry: 'UAE',
        chargeCurrency: 'AED',
        paymentProvider: 'stripe',
        couponCode: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
