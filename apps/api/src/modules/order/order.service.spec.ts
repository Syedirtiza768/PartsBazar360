import { OrderService } from './order.service';

describe('OrderService public order numbers', () => {
  it.each([
    [1110, 'PB1110'],
    [10000, 'PB10000'],
  ])('stores the public number %s as %s', async (lastNumber, expected) => {
    const tx = {
      orderNumberSequence: {
        update: jest.fn().mockResolvedValue({ lastNumber }),
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'internal-order-id' }),
        update: jest.fn().mockResolvedValue({ id: 'internal-order-id' }),
      },
      sellerOrder: {
        create: jest.fn().mockResolvedValue({ id: 'seller-order-id' }),
      },
      orderItem: {
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new OrderService(prisma as never);

    await service.createMultiSellerOrder(
      undefined,
      [
        {
          sellerOfferId: 'offer-1',
          quantity: 1,
          sellerOffer: {
            sellerId: 'seller-1',
            price: 25,
            marketplaceFee: 1,
            sellerProceeds: 24,
            sellerBasePrice: 20,
            pricingPolicyId: null,
            pricingPolicyVersion: null,
            canonicalPart: null,
          },
        },
      ],
      {},
      {},
      'AED',
      {
        customerId: 'customer-1',
        verifiedPhone: '+971500000000',
        idempotencyKey: 'checkout-1',
      },
    );

    expect(tx.orderNumberSequence.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastNumber: { increment: 1 } },
    });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderNumber: expected }),
      }),
    );
  });
});
