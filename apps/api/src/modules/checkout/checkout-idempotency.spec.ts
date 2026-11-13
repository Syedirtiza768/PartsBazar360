/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { CheckoutService } from './checkout.service';

describe('CheckoutService idempotent payment handling', () => {
  const buyer = {
    buyerId: 'buyer-1',
    name: 'Test Buyer',
    email: 'buyer@example.com',
    phone: '+971501234567',
  };
  const address = { country: 'UAE', line1: '1 Test Street', city: 'Dubai' };

  function buildService(existingOrder: Record<string, any>) {
    const cart = {
      id: 'cart-1',
      updatedAt: new Date(),
      items: [
        {
          id: 'cart-item-1',
          intendedVehicleConfigId: null,
          purchaseIntent: 'UNSPECIFIED',
          sellerOfferId: 'offer-1',
          quantity: 1,
          sellerOffer: {
            id: 'offer-1',
            canonicalPartId: 'part-1',
            sellerId: 'seller-1',
            status: 'ACTIVE',
            updatedAt: new Date(),
            price: 100,
            currency: 'AED',
            inventory: [{ quantity: 4 }],
            canonicalPart: {
              id: 'part-1',
              title: 'Brake Pad',
              updatedAt: new Date(),
            },
            seller: {
              id: 'seller-1',
              name: 'Seller',
              onboardingStatus: 'ACTIVE',
            },
          },
        },
      ],
    };
    const reserveStock = jest.fn().mockResolvedValue(true);
    const releaseStock = jest.fn().mockResolvedValue(undefined);
    const createOrder = jest.fn();
    const createStripeSession = jest.fn().mockResolvedValue({
      id: 'cs_retry',
      url: 'https://checkout.stripe.test/retry',
    });
    const authorizeCheckout = jest.fn().mockResolvedValue({
      id: 'checkout-session-1',
      customerId: 'customer-1',
      phoneNormalized: buyer.phone,
      status: 'ORDERED',
    });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: buyer.buyerId,
          customerId: 'customer-1',
          phone: buyer.phone,
          phoneVerified: true,
        }),
      },
      customer: { update: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
      order: {
        findFirst: jest.fn().mockResolvedValue(existingOrder),
        findUniqueOrThrow: jest.fn().mockResolvedValue(existingOrder),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentIntent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...existingOrder.paymentIntent,
          status: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue(existingOrder.paymentIntent),
      },
      paymentAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'attempt-retry' }),
        update: jest.fn().mockResolvedValue({}),
      },
      checkoutValidation: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (operations: any) =>
        typeof operations === 'function'
          ? operations(prisma)
          : Promise.all(operations),
      ),
    };

    const service = new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      { reserveStock, releaseStock } as any,
      { createMultiSellerOrder: createOrder } as any,
      {
        quoteSellerShipping: jest.fn().mockReturnValue({
          available: true,
          availabilityReason: null,
          requiresFreightQuote: false,
          amount: 0,
          quotedWeightKg: 1,
        }),
      } as any,
      {
        isConfigured: () => true,
        createCheckoutSession: createStripeSession,
      } as any,
      { isConfigured: () => true } as any,
      prisma as any,
      { notifyOrderUpdated: jest.fn().mockResolvedValue(undefined) } as any,
      { authorize: authorizeCheckout, trackEvent: jest.fn() } as any,
    );

    return {
      service,
      reserveStock,
      releaseStock,
      createOrder,
      createStripeSession,
      authorizeCheckout,
      prisma,
    };
  }

  const baseOrder = {
    id: 'order-1',
    customerId: 'customer-1',
    status: 'PENDING_PAYMENT',
    totalAmount: 100,
    currency: 'AED',
    verifiedPhone: buyer.phone,
    shippingAddress: address,
    sellerOrders: [
      {
        sellerId: 'seller-1',
        shippingTotal: 0,
        items: [
          {
            sellerOfferId: 'offer-1',
            quantity: 1,
            unitPrice: 100,
          },
        ],
      },
    ],
    paymentIntent: {
      id: 'payment-1',
      provider: 'stripe',
      status: 'PENDING',
      attempts: [
        {
          checkoutUrl: 'https://checkout.stripe.test/original',
          createdAt: new Date(),
        },
      ],
    },
  };

  it('never redirects a replayed paid order to an old payment session', async () => {
    const { service, createOrder, createStripeSession } = buildService({
      ...baseOrder,
      status: 'PAID',
      paymentIntent: { ...baseOrder.paymentIntent, status: 'SUCCEEDED' },
    });

    const result = await service.processCheckout(
      'cart-1',
      buyer,
      address,
      'AED',
      'stripe',
      { idempotencyKey: 'stable-key' },
    );

    expect(result).toMatchObject({ idempotentReplay: true });
    expect(result.checkoutUrl).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
    expect(createStripeSession).not.toHaveBeenCalled();
  });

  it('reuses the existing hosted session for an in-flight replay', async () => {
    const { service, reserveStock, createOrder, prisma } = buildService({
      ...baseOrder,
      checkoutValidationSnapshot: { fingerprint: 'valid-fingerprint' },
    });
    const validationSnapshot = {
      cartId: 'cart-1',
      policyVersion: 'test-policy',
      destinationCountry: 'UAE',
      chargeCurrency: 'AED',
      paymentProvider: 'stripe',
      fingerprint: 'valid-fingerprint',
      shippingAvailable: true,
      shippingQuotes: [{ sellerId: 'seller-1', amountAed: 0 }],
      lines: [
        {
          cartItemId: 'cart-item-1',
          fitmentStatus: 'NO_VEHICLE',
          blockingReason: null,
        },
      ],
      requiredAcknowledgmentCartItemIds: ['cart-item-1'],
      blockingLineIds: [],
    };
    prisma.checkoutValidation.findFirst.mockResolvedValue({
      id: 'validation-1',
      cartId: 'cart-1',
      checkoutSessionId: null,
      fingerprint: 'valid-fingerprint',
      snapshot: validationSnapshot,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    jest.spyOn(service as any, 'evaluateCheckoutCart').mockResolvedValue({
      fingerprint: 'valid-fingerprint',
      snapshot: validationSnapshot,
    });

    const result = await service.processCheckout(
      'cart-1',
      buyer,
      address,
      'AED',
      'stripe',
      {
        idempotencyKey: 'stable-key',
        validationId: 'validation-1',
        acknowledgedCartItemIds: ['cart-item-1'],
      },
    );

    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/original');
    expect(reserveStock).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(prisma.checkoutValidation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('re-reserves inventory and creates a payment attempt on decline retry', async () => {
    const failedOrder = {
      ...baseOrder,
      status: 'PAYMENT_FAILED',
      paymentIntent: { ...baseOrder.paymentIntent, status: 'FAILED' },
    };
    const {
      service,
      reserveStock,
      createOrder,
      createStripeSession,
      authorizeCheckout,
      prisma,
    } = buildService(failedOrder);
    const validationSnapshot = {
      cartId: 'cart-1',
      policyVersion: 'test-policy',
      destinationCountry: 'UAE',
      shippingAvailable: true,
      lines: [
        {
          cartItemId: 'cart-item-1',
          fitmentStatus: 'NO_VEHICLE',
          blockingReason: null,
        },
      ],
      shippingQuotes: [],
      requiredAcknowledgmentCartItemIds: ['cart-item-1'],
      blockingLineIds: [],
    };
    prisma.checkoutValidation.findFirst.mockResolvedValue({
      id: 'validation-1',
      cartId: 'cart-1',
      checkoutSessionId: 'checkout-session-1',
      fingerprint: 'valid-fingerprint',
      snapshot: validationSnapshot,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    jest.spyOn(service as any, 'evaluateCheckoutCart').mockResolvedValue({
      fingerprint: 'valid-fingerprint',
      snapshot: validationSnapshot,
    });

    const result = await service.processCheckout(
      'cart-1',
      { name: buyer.name, email: buyer.email, phone: buyer.phone },
      address,
      'AED',
      'stripe',
      {
        checkoutSessionId: 'checkout-session-1',
        checkoutToken: 'checkout-token',
        idempotencyKey: 'stable-key',
        validationId: 'validation-1',
        acknowledgedCartItemIds: ['cart-item-1'],
      },
    );

    expect(authorizeCheckout).toHaveBeenCalledWith(
      'checkout-session-1',
      'checkout-token',
      'cart-1',
      true,
      buyer.phone,
    );
    expect(reserveStock).toHaveBeenCalledWith('cart-1', 'offer-1', 1, 4);
    expect(createStripeSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ retried: true });
    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/retry');
    expect(createOrder).not.toHaveBeenCalled();
  });
});
