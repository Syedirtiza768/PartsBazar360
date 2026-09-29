import { IngestionProcessor } from './ingestion.processor';
import { pushListingId, pushStatusKey } from './realtrack-push.contract';

/**
 * IngestionProcessor's constructor opens a Redis connection, so build the
 * instance without running it and inject only what processPushedListing uses.
 */
function build(outcome: string | Error) {
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  const processor = Object.create(
    IngestionProcessor.prototype,
  ) as IngestionProcessor & Record<string, jest.Mock | typeof redis>;
  const processListing = jest.fn();
  if (outcome instanceof Error) processListing.mockRejectedValue(outcome);
  else processListing.mockResolvedValue(outcome);
  const deactivate = jest.fn().mockResolvedValue(undefined);
  Object.assign(processor, {
    redis,
    processListing,
    deactivateOfferForListing: deactivate,
  });
  return { processor, redis, processListing, deactivate };
}

const job = {
  sourceListingId: 'rt-1',
  storeId: 'store-1',
  listing: {
    title: 'Front Bumper',
    price: '99',
    marketplaceId: 'EBAY_MOTORS_US',
  },
  hints: { qualityTier: 'NEW' as const, partSource: 'AFTERMARKET' as const },
};

describe('IngestionProcessor.processPushedListing', () => {
  it('namespaces the id, pins the store and forwards provenance hints', async () => {
    const { processor, processListing } = build('imported');
    await processor.processPushedListing(job);

    expect(processListing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pushListingId('store-1', 'rt-1'),
        storeId: 'store-1',
        title: 'Front Bumper',
      }),
      'store-1',
      expect.objectContaining({
        push: true,
        qualityTier: 'NEW',
        partSource: 'AFTERMARKET',
      }),
    );
  });

  it('records an imported listing and leaves the offer on sale', async () => {
    const { processor, redis, deactivate } = build('imported');
    await expect(processor.processPushedListing(job)).resolves.toEqual({
      sourceListingId: 'rt-1',
      outcome: 'imported',
    });
    expect(deactivate).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      pushStatusKey('store-1', 'rt-1'),
      expect.stringContaining('"status":"imported"'),
      'EX',
      expect.any(Number),
    );
  });

  it('takes an existing offer off sale when a re-push is no longer eligible', async () => {
    const { processor, redis, deactivate } = build(
      'skipped_inactive_or_zero_stock',
    );
    await processor.processPushedListing({
      ...job,
      listing: { ...job.listing, quantityAvailable: 0 },
    });

    expect(deactivate).toHaveBeenCalledWith(
      expect.objectContaining({ id: pushListingId('store-1', 'rt-1') }),
      'store-1',
    );
    expect(redis.set).toHaveBeenCalledWith(
      pushStatusKey('store-1', 'rt-1'),
      expect.stringMatching(
        /"status":"rejected".*"outcome":"skipped_inactive_or_zero_stock"/,
      ),
      'EX',
      expect.any(Number),
    );
  });

  it('records the failure and rethrows so BullMQ retries', async () => {
    const { processor, redis } = build(new Error('db down'));
    await expect(processor.processPushedListing(job)).rejects.toThrow(
      'db down',
    );
    expect(redis.set).toHaveBeenCalledWith(
      pushStatusKey('store-1', 'rt-1'),
      expect.stringMatching(/"status":"failed".*db down/),
      'EX',
      expect.any(Number),
    );
  });
});
