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
      items: [
        {
          sellerOfferId: 'offer-1',
          quantity: 1,
          sellerOffer: {
            price: 100,
            currency: 'AED',
            inventory: [{ quantity: 4 }],
            canonicalPart: { title: 'Brake Pad' },
            seller: { name: 'Seller' },
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
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };

    const service = new CheckoutService(
      { getCart: jest.fn().mockResolvedValue(cart) } as any,
      { reserveStock, releaseStock } as any,
      { createMultiSellerOrder: createOrder } as any,
      {} as any,
      {
        isConfigured: () => true,
        createCheckoutSession: createStripeSession,
      } as any,
      { isConfigured: () => true } as any,
      prisma as any,
      {} as any,
      { authorize: authorizeCheckout, trackEvent: jest.fn() } as any,
    );

    return {
      service,
      reserveStock,
      releaseStock,
      createOrder,
      createStripeSession,
      authorizeCheckout,
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
    const { service, reserveStock, createOrder } = buildService(baseOrder);

    const result = await service.processCheckout(
      'cart-1',
      buyer,
      address,
      'AED',
      'stripe',
      { idempotencyKey: 'stable-key' },
    );

    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/original');
    expect(reserveStock).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
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
    } = buildService(failedOrder);

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
      },
    );

    expect(authorizeCheckout).toHaveBeenCalledWith(
      'checkout-session-1',
      'checkout-token',
      'cart-1',
      true,
    );
    expect(reserveStock).toHaveBeenCalledWith('cart-1', 'offer-1', 1, 4);
    expect(createStripeSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ retried: true });
    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/retry');
    expect(createOrder).not.toHaveBeenCalled();
  });
});
