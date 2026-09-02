import { buildPurchaseTrackingPayload } from './purchase-tracking.util';

const paidOrder = {
  id: 'order-uuid',
  orderNumber: 'PB1234',
  status: 'PAID',
  totalAmount: 288,
  discountAmount: 7,
  currency: 'aed',
  paymentIntent: { status: 'SUCCEEDED' },
  sellerOrders: [
    {
      shippingTotal: 15,
      items: [
        {
          sellerOfferId: 'offer-1',
          quantity: 2,
          unitPrice: 100,
          sellerOffer: {
            canonicalPart: { id: 'part-1', title: 'Brake disc' },
          },
        },
        {
          sellerOfferId: 'offer-2',
          quantity: 1,
          unitPrice: 60,
          sellerOffer: {
            canonicalPart: { id: 'part-2', title: 'Brake pad set' },
          },
        },
      ],
    },
  ],
};

describe('buildPurchaseTrackingPayload', () => {
  it('requires both a paid order and a succeeded payment', () => {
    expect(
      buildPurchaseTrackingPayload({
        ...paidOrder,
        status: 'PENDING_PAYMENT',
      }),
    ).toBeNull();
    expect(
      buildPurchaseTrackingPayload({
        ...paidOrder,
        paymentIntent: { status: 'PENDING' },
      }),
    ).toBeNull();
  });

  it('uses the authoritative multi-item order snapshot and derives totals', () => {
    expect(buildPurchaseTrackingPayload(paidOrder)).toEqual({
      transaction_id: 'PB1234',
      value: 288,
      currency: 'AED',
      tax: 20,
      shipping: 15,
      items: [
        {
          item_id: 'part-1',
          item_name: 'Brake disc',
          price: 100,
          quantity: 2,
        },
        {
          item_id: 'part-2',
          item_name: 'Brake pad set',
          price: 60,
          quantity: 1,
        },
      ],
    });
  });

  it('falls back to backend offer identifiers without inventing values', () => {
    expect(
      buildPurchaseTrackingPayload({
        ...paidOrder,
        orderNumber: null,
        totalAmount: 75,
        discountAmount: 0,
        sellerOrders: [
          {
            shippingTotal: 0,
            items: [
              {
                sellerOfferId: 'offer-fallback',
                quantity: 1,
                unitPrice: 75,
                sellerOffer: null,
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      transaction_id: 'order-uuid',
      items: [
        {
          item_id: 'offer-fallback',
          item_name: 'offer-fallback',
        },
      ],
    });
  });
});
