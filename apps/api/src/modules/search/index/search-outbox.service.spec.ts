import {
  SearchOutboxService,
  backoffMs,
  MAX_ATTEMPTS,
} from './search-outbox.service';

/** Minimal in-memory stand-in for the `searchOutbox` Prisma delegate. */
function makePrisma(rows: any[]) {
  const store = [...rows];
  return {
    store,
    searchOutbox: {
      findMany: jest.fn(async ({ where, take }: any) => {
        let out = store.filter((row) => row.status === where.status);
        if (where.availableAt?.lte) {
          out = out.filter((row) => row.availableAt <= where.availableAt.lte);
        }
        return out.slice(0, take ?? out.length);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of store) {
          const idMatch = where.id?.in ? where.id.in.includes(row.id) : true;
          const statusMatch = where.status ? row.status === where.status : true;
          if (idMatch && statusMatch) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      }),
      create: jest.fn(async ({ data }: any) => {
        store.push({ id: `row-${store.length}`, attempts: 0, ...data });
        return store[store.length - 1];
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const row of data) store.push({ id: `row-${store.length}`, attempts: 0, ...row });
        return { count: data.length };
      }),
      groupBy: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
  } as any;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'row-1',
  entityId: 'part-1',
  operation: 'UPSERT',
  status: 'PENDING',
  attempts: 0,
  availableAt: new Date(0),
  ...over,
});

describe('backoffMs', () => {
  it('grows exponentially and is capped', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    expect(backoffMs(99)).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe('SearchOutboxService.drain', () => {
  it('marks a row DONE only after the index write succeeds', async () => {
    // The production bug: uploads.service marks rows DONE regardless, because
    // OpenSearchService.indexPart swallows its own errors. 198,129 DONE rows
    // coexist with 14,680 parts missing from the index.
    const prisma = makePrisma([row()]);
    const indexer = { indexPart: jest.fn(async () => 'INDEXED'), removePart: jest.fn() };
    const service = new SearchOutboxService(prisma, indexer as any);

    const result = await service.drain();

    expect(indexer.indexPart).toHaveBeenCalledWith('part-1');
    expect(result.indexed).toBe(1);
    expect(prisma.store[0].status).toBe('DONE');
  });

  it('does NOT mark a row DONE when the index write throws', async () => {
    const prisma = makePrisma([row()]);
    const indexer = {
      indexPart: jest.fn(async () => {
        throw new Error('opensearch unreachable');
      }),
      removePart: jest.fn(),
    };
    const service = new SearchOutboxService(prisma, indexer as any);

    const result = await service.drain();

    expect(result.indexed).toBe(0);
    expect(result.retried).toBe(1);
    expect(prisma.store[0].status).toBe('PENDING');
    expect(prisma.store[0].attempts).toBe(1);
    expect(prisma.store[0].lastError).toContain('opensearch unreachable');
  });

  it('schedules a retry in the future rather than hot-looping', async () => {
    const prisma = makePrisma([row()]);
    const indexer = {
      indexPart: jest.fn(async () => {
        throw new Error('boom');
      }),
      removePart: jest.fn(),
    };
    await new SearchOutboxService(prisma, indexer as any).drain();
    expect(prisma.store[0].availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('dead-letters a row that exhausts its attempts', async () => {
    const prisma = makePrisma([row({ attempts: MAX_ATTEMPTS - 1 })]);
    const indexer = {
      indexPart: jest.fn(async () => {
        throw new Error('permanent');
      }),
      removePart: jest.fn(),
    };
    const service = new SearchOutboxService(prisma, indexer as any);

    const result = await service.drain();

    expect(result.deadLettered).toBe(1);
    expect(prisma.store[0].status).toBe('FAILED');
  });

  it('collapses duplicate rows for the same part into one index write', async () => {
    // A bulk import writes one row per offer; the document is rebuilt from
    // current state either way, so indexing once is correct and much cheaper.
    const prisma = makePrisma([
      row({ id: 'a', entityId: 'part-1' }),
      row({ id: 'b', entityId: 'part-1' }),
      row({ id: 'c', entityId: 'part-1' }),
    ]);
    const indexer = { indexPart: jest.fn(async () => 'INDEXED'), removePart: jest.fn() };
    const service = new SearchOutboxService(prisma, indexer as any);

    await service.drain();

    expect(indexer.indexPart).toHaveBeenCalledTimes(1);
    expect(prisma.store.every((r: any) => r.status === 'DONE')).toBe(true);
  });

  it('removes the part from the index for a DELETE row', async () => {
    const prisma = makePrisma([row({ operation: 'DELETE' })]);
    const indexer = { indexPart: jest.fn(), removePart: jest.fn(async () => undefined) };
    const service = new SearchOutboxService(prisma, indexer as any);

    const result = await service.drain();

    expect(indexer.removePart).toHaveBeenCalledWith('part-1');
    expect(indexer.indexPart).not.toHaveBeenCalled();
    expect(result.deleted).toBe(1);
  });

  it('claims rows so a second worker skips them', async () => {
    const prisma = makePrisma([row()]);
    const indexer = { indexPart: jest.fn(async () => 'INDEXED'), removePart: jest.fn() };
    const service = new SearchOutboxService(prisma, indexer as any);

    await service.drain();

    const statuses = prisma.searchOutbox.updateMany.mock.calls.map(
      (call: any[]) => call[0].data.status,
    );
    expect(statuses[0]).toBe('PROCESSING');
  });

  it('does not overlap with itself', async () => {
    const prisma = makePrisma([row()]);

    let markStarted: () => void;
    const indexStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseIndex: (outcome: string) => void = () => {};

    const indexer = {
      // Parks until the test releases it, so the first drain is provably
      // still in flight when the second is called.
      indexPart: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            releaseIndex = resolve;
            markStarted();
          }),
      ),
      removePart: jest.fn(),
    };
    const service = new SearchOutboxService(prisma, indexer as any);

    const first = service.drain();
    await indexStarted;

    const second = await service.drain();
    expect(second.claimed).toBe(0);
    expect(indexer.indexPart).toHaveBeenCalledTimes(1);

    releaseIndex('INDEXED');
    await first;
  });

  it('is a no-op when nothing is due', async () => {
    const prisma = makePrisma([]);
    const indexer = { indexPart: jest.fn(), removePart: jest.fn() };
    const result = await new SearchOutboxService(prisma, indexer as any).drain();
    expect(result.claimed).toBe(0);
    expect(indexer.indexPart).not.toHaveBeenCalled();
  });

  it('leaves rows scheduled for the future alone', async () => {
    const prisma = makePrisma([row({ availableAt: new Date(Date.now() + 60_000) })]);
    const indexer = { indexPart: jest.fn(), removePart: jest.fn() };
    await new SearchOutboxService(prisma, indexer as any).drain();
    expect(indexer.indexPart).not.toHaveBeenCalled();
  });
});

describe('SearchOutboxService.enqueue', () => {
  it('records a part for reindexing', async () => {
    const prisma = makePrisma([]);
    const service = new SearchOutboxService(prisma, {} as any);
    await service.enqueue('part-9', 'UPSERT', 'price-change');
    expect(prisma.store[0]).toMatchObject({
      entityId: 'part-9',
      operation: 'UPSERT',
      status: 'PENDING',
    });
  });

  it('bulk-enqueues without a row per round trip', async () => {
    const prisma = makePrisma([]);
    const service = new SearchOutboxService(prisma, {} as any);
    const count = await service.enqueueMany(['a', 'b', 'c'], 'DELETE', 'reconcile');
    expect(count).toBe(3);
    expect(prisma.searchOutbox.createMany).toHaveBeenCalledTimes(1);
  });

  it('handles an empty bulk enqueue', async () => {
    const prisma = makePrisma([]);
    const service = new SearchOutboxService(prisma, {} as any);
    expect(await service.enqueueMany([])).toBe(0);
    expect(prisma.searchOutbox.createMany).not.toHaveBeenCalled();
  });
});
