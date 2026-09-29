import { NotFoundException } from '@nestjs/common';
import { RealtrackPublishService } from './realtrack-publish.service';
import {
  PUSH_JOB_NAME,
  pushListingId,
  pushStatusKey,
} from '../ingestion/realtrack-push.contract';

const STORE = 'store-1';
const SELLER = { id: 'seller-1', name: 'Blackline Auto Parts' };

function build() {
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
  };
  const queue = {
    client: Promise.resolve(redis),
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const prisma = {
    seller: { findFirst: jest.fn().mockResolvedValue(SELLER) },
    sellerOffer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new RealtrackPublishService(
    prisma as never,
    outbox as never,
    queue as never,
  );
  return { service, redis, queue, prisma, outbox };
}

const listing = (title = 'Front Bumper') => ({
  title,
  price: '99',
  currency: 'USD',
  quantityAvailable: 1,
});

describe('RealtrackPublishService', () => {
  it('refuses a store that has no mapped seller', async () => {
    const { service, prisma, queue } = build();
    prisma.seller.findFirst.mockResolvedValue(null);
    await expect(
      service.publish({
        storeId: STORE,
        listings: [{ sourceListingId: 'a', listing: listing() }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues valid listings and rejects invalid ones without failing the batch', async () => {
    const { service, queue, redis } = build();
    const result = await service.publish({
      storeId: STORE,
      listings: [
        { sourceListingId: 'good', listing: listing() },
        { sourceListingId: 'bad', listing: { ...listing(), price: 'free' } },
      ],
    });

    expect(result.results).toEqual([
      { sourceListingId: 'good', status: 'queued' },
      expect.objectContaining({ sourceListingId: 'bad', status: 'rejected' }),
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      PUSH_JOB_NAME,
      expect.objectContaining({ sourceListingId: 'good', storeId: STORE }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      pushStatusKey(STORE, 'good'),
      expect.stringContaining('"status":"queued"'),
      { EX: expect.any(Number) },
    );
  });

  it('ends only offers owned by the mapped seller, under the push namespace', async () => {
    const { service, prisma, outbox } = build();
    prisma.sellerOffer.findMany.mockResolvedValueOnce([
      { id: 'offer-1', canonicalPartId: 'part-1', status: 'ACTIVE' },
    ]);

    const result = await service.end({
      storeId: STORE,
      sourceListingIds: ['found', 'missing'],
    });

    expect(prisma.sellerOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sellerId: SELLER.id,
          externalOfferId: pushListingId(STORE, 'found'),
        },
      }),
    );
    expect(prisma.sellerOffer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['offer-1'] } },
      data: { status: 'INACTIVE' },
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'part-1',
      'UPSERT',
      'RT_PUSH_END',
    );
    expect(result.results).toEqual([
      { sourceListingId: 'found', status: 'ended' },
      { sourceListingId: 'missing', status: 'not_found' },
    ]);
  });

  it('reports catalog state even when the Redis record has expired', async () => {
    const { service, prisma } = build();
    prisma.sellerOffer.findFirst.mockResolvedValue({
      id: 'offer-1',
      status: 'ACTIVE',
      price: 150,
      currency: 'USD',
      canonicalPart: { id: 'part-1', slug: null },
    });

    const status = await service.status(STORE, 'src-1');
    expect(status.status).toBe('imported');
    expect(status.part).toEqual({ id: 'part-1', slug: null, url: null });
  });

  it('reports unknown when neither Redis nor the catalog has the listing', async () => {
    const { service } = build();
    const status = await service.status(STORE, 'nope');
    expect(status.status).toBe('unknown');
    expect(status.offer).toBeNull();
  });
});
