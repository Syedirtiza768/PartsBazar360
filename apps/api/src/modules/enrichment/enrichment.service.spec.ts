import { EnrichmentService, ENRICHMENT_VERSION } from './enrichment.service';

describe('EnrichmentService', () => {
  const ORIGINAL_ENV = { ...process.env };

  function build() {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const update = jest.fn().mockResolvedValue({});
    const service = new EnrichmentService(
      { add } as any,
      { canonicalPart: { update } } as any,
    );
    return { service, add, update };
  }

  beforeEach(() => {
    process.env.ENRICHMENT_ENABLED = '1';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  describe('needsEnrichment', () => {
    const current = { enrichmentVersion: ENRICHMENT_VERSION };

    it('skips a part with a measured weight and item specifics', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          weight: 1.6,
          weightSource: 'SPREADSHEET',
          itemSpecifics: { partType: 'Brake Pad' },
          enrichmentStatus: 'DONE',
        }),
      ).toBe(false);
    });

    it('enriches a part with no weight', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          itemSpecifics: { partType: 'Brake Pad' },
        }),
      ).toBe(true);
    });

    it('enriches a part whose weight came from a previous AI run', () => {
      const { service } = build();
      // AI is not an exact source, so a better source is still worth seeking.
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          weight: 2,
          weightSource: 'AI',
          itemSpecifics: { partType: 'x' },
        }),
      ).toBe(true);
    });

    it('enriches when item specifics are missing', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          weight: 1.6,
          weightSource: 'SPREADSHEET',
          itemSpecifics: null,
        }),
      ).toBe(true);
    });

    it('does not retry a part that already failed', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          itemSpecifics: { a: 1 },
          enrichmentStatus: 'FAILED',
        }),
      ).toBe(false);
    });

    it('re-enriches when the pipeline version has moved on', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          id: 'p1',
          weight: 1.6,
          weightSource: 'SPREADSHEET',
          itemSpecifics: { a: 1 },
          enrichmentStatus: 'DONE',
          enrichmentVersion: ENRICHMENT_VERSION - 1,
        }),
      ).toBe(true);
    });
  });

  describe('requestEnrichment', () => {
    const candidate = {
      id: 'part-1',
      enrichmentVersion: ENRICHMENT_VERSION,
      itemSpecifics: null,
    };

    it('queues one deduplicated job and marks the part queued', async () => {
      const { service, add, update } = build();
      await service.requestEnrichment(candidate);

      expect(add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = add.mock.calls[0];
      expect(name).toBe('enrich-part');
      expect(data).toMatchObject({ partId: 'part-1', reason: 'pdp_view' });
      // Dedup key must be stable so concurrent views collapse to one job.
      expect(opts.jobId).toBe(`enrich:part-1:v${ENRICHMENT_VERSION}`);
      expect(update).toHaveBeenCalledWith({
        where: { id: 'part-1' },
        data: { enrichmentStatus: 'QUEUED' },
      });
    });

    it('does nothing when the feature flag is off', async () => {
      process.env.ENRICHMENT_ENABLED = '0';
      const { service, add } = build();
      await service.requestEnrichment(candidate);
      expect(add).not.toHaveBeenCalled();
    });

    it('does nothing without an API key', async () => {
      delete process.env.OPENROUTER_API_KEY;
      const { service, add } = build();
      await service.requestEnrichment(candidate);
      expect(add).not.toHaveBeenCalled();
    });

    it('skips a part already in flight', async () => {
      const { service, add } = build();
      await service.requestEnrichment({
        ...candidate,
        enrichmentStatus: 'RUNNING',
      });
      expect(add).not.toHaveBeenCalled();
    });

    it('never throws when the queue is unavailable', async () => {
      const add = jest.fn().mockRejectedValue(new Error('redis down'));
      const service = new EnrichmentService(
        { add } as any,
        { canonicalPart: { update: jest.fn() } } as any,
      );

      // This runs on the PDP read path, so a broken queue must not surface.
      await expect(service.requestEnrichment(candidate)).resolves.toBeUndefined();
    });
  });

  describe('requestEnrichmentForMany', () => {
    it('caps speculative work and deprioritises it', async () => {
      const { service, add } = build();
      const parts = Array.from({ length: 20 }, (_, i) => ({
        id: `part-${i}`,
        enrichmentVersion: ENRICHMENT_VERSION,
        itemSpecifics: null,
      }));

      await service.requestEnrichmentForMany(parts, { limit: 5 });

      expect(add).toHaveBeenCalledTimes(5);
      // Pre-warming must not outrank a part a buyer is actually looking at.
      expect(add.mock.calls[0][2].priority).toBeGreaterThan(5);
    });

    it('filters out parts that do not need enrichment', async () => {
      const { service, add } = build();
      await service.requestEnrichmentForMany([
        {
          id: 'good',
          weight: 1.6,
          weightSource: 'SPREADSHEET',
          itemSpecifics: { a: 1 },
          enrichmentVersion: ENRICHMENT_VERSION,
        },
        {
          id: 'needs-it',
          itemSpecifics: null,
          enrichmentVersion: ENRICHMENT_VERSION,
        },
      ]);

      expect(add).toHaveBeenCalledTimes(1);
      expect(add.mock.calls[0][1].partId).toBe('needs-it');
    });
  });

  describe('requestEnrichmentByIds', () => {
    it('loads candidates from the database before queueing', async () => {
      const add = jest.fn().mockResolvedValue({ id: 'job-1' });
      const update = jest.fn().mockResolvedValue({});
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'part-1',
          weight: null,
          weightSource: null,
          itemSpecifics: null,
          enrichmentVersion: ENRICHMENT_VERSION,
        },
      ]);
      const service = new EnrichmentService(
        { add } as any,
        { canonicalPart: { update, findMany } } as any,
      );

      const count = await service.requestEnrichmentByIds(['part-1', 'part-1'], {
        reason: 'intent',
      });

      expect(findMany).toHaveBeenCalled();
      expect(add).toHaveBeenCalledTimes(1);
      expect(count).toBe(1);
    });

    it('returns zero when enrichment is disabled', async () => {
      process.env.ENRICHMENT_ENABLED = '0';
      const findMany = jest.fn();
      const service = new EnrichmentService(
        { add: jest.fn() } as any,
        { canonicalPart: { findMany } } as any,
      );

      expect(await service.requestEnrichmentByIds(['part-1'])).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
