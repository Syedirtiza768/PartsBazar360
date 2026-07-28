import {
  EnrichmentService,
  ENRICHMENT_VERSION,
  ENRICHMENT_PDP_PRIORITY,
  ENRICHMENT_PREWARM_PRIORITY,
} from './enrichment.service';

describe('EnrichmentService', () => {
  const ORIGINAL_ENV = { ...process.env };

  function build(queueExtras: Record<string, unknown> = {}) {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const getJob = jest.fn().mockResolvedValue(null);
    const getWaitingCount = jest.fn().mockResolvedValue(0);
    const getPrioritizedCount = jest.fn().mockResolvedValue(0);
    const update = jest.fn().mockResolvedValue({});
    const service = new EnrichmentService(
      {
        add,
        getJob,
        getWaitingCount,
        getPrioritizedCount,
        ...queueExtras,
      } as any,
      { canonicalPart: { update } } as any,
    );
    return { service, add, update, getJob, getWaitingCount, getPrioritizedCount };
  }

  beforeEach(() => {
    process.env.ENRICHMENT_ENABLED = '1';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    delete process.env.ENRICHMENT_PREWARM;
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

    it('does not re-enrich a DONE AI-weight part with item specifics', () => {
      const { service } = build();
      expect(
        service.needsEnrichment({
          ...current,
          id: 'p1',
          weight: 2,
          weightSource: 'AI',
          itemSpecifics: { partType: 'x' },
          enrichmentStatus: 'DONE',
        }),
      ).toBe(false);
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

    it('queues one deduplicated job at PDP priority', async () => {
      const { service, add, update } = build();
      await service.requestEnrichment(candidate);

      expect(add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = add.mock.calls[0];
      expect(name).toBe('enrich-part');
      expect(data).toMatchObject({ partId: 'part-1', reason: 'pdp_view' });
      expect(opts.jobId).toBe(`enrich:part-1:v${ENRICHMENT_VERSION}`);
      expect(opts.priority).toBe(ENRICHMENT_PDP_PRIORITY);
      expect(update).toHaveBeenCalledWith({
        where: { id: 'part-1' },
        data: { enrichmentStatus: 'QUEUED' },
      });
    });

    it('promotes a queued prewarm job when the PDP opens', async () => {
      const changePriority = jest.fn().mockResolvedValue(undefined);
      const updateData = jest.fn().mockResolvedValue(undefined);
      const getState = jest.fn().mockResolvedValue('waiting');
      const { service, add, getJob } = build();
      getJob.mockResolvedValue({
        opts: { priority: ENRICHMENT_PREWARM_PRIORITY },
        data: { partId: 'part-1', reason: 'search_results' },
        changePriority,
        updateData,
        getState,
      });

      await service.requestEnrichment(
        { ...candidate, enrichmentStatus: 'QUEUED' },
        { reason: 'pdp_view', priority: ENRICHMENT_PDP_PRIORITY },
      );

      expect(add).not.toHaveBeenCalled();
      expect(changePriority).toHaveBeenCalledWith({
        priority: ENRICHMENT_PDP_PRIORITY,
      });
      expect(updateData).toHaveBeenCalled();
    });

    it('does not promote on speculative re-request while queued', async () => {
      const changePriority = jest.fn();
      const { service, add, getJob } = build();
      getJob.mockResolvedValue({
        opts: { priority: ENRICHMENT_PREWARM_PRIORITY },
        changePriority,
        getState: jest.fn().mockResolvedValue('waiting'),
      });

      await service.requestEnrichment(
        { ...candidate, enrichmentStatus: 'QUEUED' },
        { reason: 'search_results', priority: ENRICHMENT_PREWARM_PRIORITY },
      );

      expect(add).not.toHaveBeenCalled();
      expect(changePriority).not.toHaveBeenCalled();
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
        {
          add,
          getJob: jest.fn(),
          getWaitingCount: jest.fn(),
          getPrioritizedCount: jest.fn(),
        } as any,
        { canonicalPart: { update: jest.fn() } } as any,
      );

      await expect(service.requestEnrichment(candidate)).resolves.toBeUndefined();
    });
  });

  describe('requestEnrichmentForMany', () => {
    it('is a no-op when prewarm is disabled (default)', async () => {
      const { service, add } = build();
      const parts = Array.from({ length: 10 }, (_, i) => ({
        id: `part-${i}`,
        enrichmentVersion: ENRICHMENT_VERSION,
        itemSpecifics: null,
      }));

      await service.requestEnrichmentForMany(parts, { limit: 5 });
      expect(add).not.toHaveBeenCalled();
    });

    it('caps speculative work and deprioritises it when enabled', async () => {
      process.env.ENRICHMENT_PREWARM = '1';
      const { service, add } = build();
      const parts = Array.from({ length: 20 }, (_, i) => ({
        id: `part-${i}`,
        enrichmentVersion: ENRICHMENT_VERSION,
        itemSpecifics: null,
      }));

      await service.requestEnrichmentForMany(parts, { limit: 5 });

      expect(add).toHaveBeenCalledTimes(5);
      expect(add.mock.calls[0][2].priority).toBe(ENRICHMENT_PREWARM_PRIORITY);
      expect(add.mock.calls[0][2].priority).toBeGreaterThan(ENRICHMENT_PDP_PRIORITY);
    });

    it('skips prewarm when the waiting backlog is already full', async () => {
      process.env.ENRICHMENT_PREWARM = '1';
      process.env.ENRICHMENT_PREWARM_MAX_BACKLOG = '4';
      const { service, add, getWaitingCount, getPrioritizedCount } = build();
      getWaitingCount.mockResolvedValue(2);
      getPrioritizedCount.mockResolvedValue(3);

      await service.requestEnrichmentForMany(
        [{ id: 'p1', enrichmentVersion: ENRICHMENT_VERSION, itemSpecifics: null }],
        { limit: 5 },
      );

      expect(add).not.toHaveBeenCalled();
    });
  });

  describe('requestEnrichmentByIds', () => {
    it('returns zero when prewarm is disabled', async () => {
      const findMany = jest.fn();
      const service = new EnrichmentService(
        {
          add: jest.fn(),
          getJob: jest.fn(),
          getWaitingCount: jest.fn(),
          getPrioritizedCount: jest.fn(),
        } as any,
        { canonicalPart: { findMany } } as any,
      );

      expect(await service.requestEnrichmentByIds(['part-1'], { reason: 'intent' })).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('loads candidates from the database when prewarm is on', async () => {
      process.env.ENRICHMENT_PREWARM = '1';
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
        {
          add,
          getJob: jest.fn().mockResolvedValue(null),
          getWaitingCount: jest.fn().mockResolvedValue(0),
          getPrioritizedCount: jest.fn().mockResolvedValue(0),
        } as any,
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
      process.env.ENRICHMENT_PREWARM = '1';
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
