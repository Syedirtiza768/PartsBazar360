import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { PrismaService } from '../../prisma.service';
import { buildPurchaseConversion } from '../checkout/purchase-tracking.util';
import { AdvertisingService } from './advertising.service';
import { conversionPayload, type Conversion } from './advertising-payload';

const context = {
  consentId: '9e0d950e-8874-4f5e-a631-861827d0d343',
  agent: 'Mozilla/5.0',
  ttclid: 'sample-click',
};
const event: Conversion = {
  name: 'Purchase',
  id: 'order_sample',
  currency: 'AED',
  value: 113,
  items: [{ partId: 'part-8', offerId: 'offer-3', quantity: 2, price: 50 }],
};
const date = new Date('2026-11-14T12:00:00.000Z');

describe('storefront advertising', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ADVERTISING_ENABLED: '1',
      ADVERTISING_META_CONFIGURED: '1',
      ADVERTISING_META_TOKEN: 'fixture',
      ADVERTISING_META_VERSION: 'v26.0',
      ADVERTISING_META_CATALOG_KEY: 'partId',
      ADVERTISING_META_CURRENCIES: 'AED,USD',
      ADVERTISING_TIKTOK_CONFIGURED: '1',
      ADVERTISING_TIKTOK_TOKEN: 'fixture',
      ADVERTISING_TIKTOK_CATALOG_KEY: 'offerId',
      ADVERTISING_TIKTOK_CURRENCIES: 'AED',
      BUYER_APP_URL: 'https://partsbazar360.com/buyer',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('keeps the same order event ID, value, currency and quantity for both destinations', () => {
    expect(
      conversionPayload(
        event,
        'meta',
        { catalogKey: 'partId', currencies: ['AED'] },
        context,
        date,
      ),
    ).toMatchObject({
      data: [
        {
          event_name: 'Purchase',
          event_id: event.id,
          action_source: 'website',
          event_source_url: 'https://partsbazar360.com/buyer/checkout/success/',
          custom_data: {
            value: 113,
            currency: 'AED',
            content_ids: ['part-8'],
            num_items: 2,
          },
        },
      ],
    });
    expect(
      conversionPayload(
        event,
        'tiktok',
        { catalogKey: 'offerId', currencies: ['AED'] },
        context,
        date,
      ),
    ).toMatchObject({
      event_source_id: 'DBS6C7RC77U657ENO7K0',
      data: [
        {
          event: 'Purchase',
          event_id: event.id,
          properties: {
            value: 113,
            currency: 'AED',
            contents: [{ content_id: 'offer-3', price: 50, quantity: 2 }],
          },
        },
      ],
    });
  });

  it('skips unmapped items and unsupported currencies', () => {
    const config = { catalogKey: 'offerId' as const, currencies: ['USD'] };
    expect(
      conversionPayload(event, 'tiktok', config, context, date),
    ).toBeUndefined();
    expect(
      conversionPayload(
        {
          ...event,
          currency: 'USD',
          items: [{ partId: 'part-8', quantity: 2, price: 50 }],
        },
        'tiktok',
        config,
        context,
        date,
      ),
    ).toBeUndefined();
  });

  it('projects an advertising purchase only after payment succeeds', () => {
    const order = {
      id: 'sample',
      status: 'PENDING_PAYMENT',
      totalAmount: 113,
      currency: 'AED',
      paymentIntent: { status: 'FAILED' },
      sellerOrders: [
        {
          shippingTotal: 13,
          items: [{ sellerOfferId: 'offer-3', quantity: 2, unitPrice: 50 }],
        },
      ],
    };
    expect(buildPurchaseConversion(order)).toBeUndefined();
    expect(
      buildPurchaseConversion({ ...order, status: 'PAID' }),
    ).toBeUndefined();
    expect(
      buildPurchaseConversion({
        ...order,
        status: 'PAID',
        paymentIntent: { status: 'SUCCEEDED' },
      }),
    ).toMatchObject({
      id: 'order_sample',
      value: 113,
      currency: 'AED',
      items: [{ offerId: 'offer-3', quantity: 2 }],
    });
  });

  it('skips capture when disabled, the cookie is absent, or the grant was withdrawn', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    const service = new AdvertisingService({
      advertisingConsent: { findUnique },
    } as unknown as PrismaService);
    const request = (cookie?: string) =>
      ({
        headers: { cookie },
        get: (name: string) =>
          name === 'user-agent' ? 'Mozilla/5.0' : undefined,
      }) as unknown as Request;
    expect(await service.context(request())).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
    expect(
      await service.context(
        request('pb_advertising_consent=' + context.consentId),
      ),
    ).toBeUndefined();
    expect(findUnique).toHaveBeenCalledTimes(1);
    process.env.ADVERTISING_ENABLED = '0';
    expect(
      await service.context(
        request('pb_advertising_consent=' + context.consentId),
      ),
    ).toBeUndefined();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('queues a replay-safe record per vendor using the same event identity', async () => {
    const service = new AdvertisingService({} as PrismaService);
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    await service.enqueue(
      {
        advertisingDelivery: { createMany },
      } as unknown as Prisma.TransactionClient,
      event,
      context,
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ vendor: 'meta', eventId: event.id }),
        expect.objectContaining({ vendor: 'tiktok', eventId: event.id }),
      ],
      skipDuplicates: true,
    });
  });

  function delivery() {
    const now = new Date();
    const row = {
      id: 'row',
      vendor: 'tiktok',
      event,
      attribution: context,
      consentId: context.consentId,
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const updateMany = jest
      .fn<
        Promise<{ count: number }>,
        [args: { data: Record<string, unknown> }]
      >()
      .mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({
      expiresAt: new Date(now.getTime() + 1000),
      revokedAt: null,
    });
    const service = new AdvertisingService({
      advertisingConsent: { findUnique },
      advertisingDelivery: { findMany, updateMany },
    } as unknown as PrismaService);
    return { service, updateMany, findUnique };
  }

  it('keeps the vendor event ID if a delivery must retry', async () => {
    const { service, updateMany } = delivery();
    const outgoing = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }));
    await service.drain();
    expect(outgoing).toHaveBeenCalledTimes(1);
    const body = outgoing.mock.calls[0][1]?.body;
    if (typeof body !== 'string')
      throw new Error('Expected a JSON request body');
    const payload: unknown = JSON.parse(body);
    expect(payload).toMatchObject({
      data: [{ event: 'Purchase', event_id: event.id }],
    });
    const retry = updateMany.mock.calls[1][0].data;
    expect(Object.keys(retry)).toEqual(['nextAttemptAt']);
    expect(retry.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('suppresses pending delivery after withdrawal', async () => {
    const { service, updateMany, findUnique } = delivery();
    findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    const outgoing = jest.spyOn(globalThis, 'fetch');
    await service.drain();
    expect(outgoing).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[1][0].data).toMatchObject({
      result: 'suppressed',
      attribution: {},
    });
  });

  it('checks the vendor response body before recording API acceptance', async () => {
    const { service, updateMany } = delivery();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ code: 40002 }));
    await service.drain();
    expect(updateMany.mock.calls[1][0].data).toMatchObject({
      result: 'rejected',
      attribution: {},
    });
  });
});
