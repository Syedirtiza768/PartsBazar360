import { normalizePartNumber } from '../../query/part-number.util';
import { PortalOptionsService } from './portal-options.service';

/**
 * A miniature catalogue reproducing the cases the acceptance tests name:
 * exact part, aftermarket replacement (+ the same product on another
 * listing), a cross-reference one hop away, a same-digits part of another
 * make, and an other-make cross-reference that must be excluded.
 */
const PARTS: MockPart[] = [
  {
    id: 't1',
    title: 'Toyota Corolla lane camera 86401-12020',
    brand: 'Toyota',
    partSource: 'OEM',
    mpn: '86401-12020',
    oe: ['86401-12020', '86401-12021'],
    makes: ['Toyota'],
  },
  {
    id: 'f1',
    title: 'Febest camera bracket',
    brand: 'Febest',
    partSource: 'AFTERMARKET',
    mpn: '0128-ZZT240',
    oe: ['8640112020'],
    makes: ['Toyota'],
  },
  {
    id: 'f2',
    title: 'Febest camera bracket (other seller)',
    brand: 'Febest',
    partSource: 'AFTERMARKET',
    mpn: '0128ZZT240',
    oe: [],
    makes: [],
  },
  {
    id: 'a1',
    title: 'Denso lane camera',
    brand: 'Denso',
    partSource: 'AFTERMARKET',
    mpn: 'DN-55555',
    oe: ['86401-12021'],
    makes: ['Toyota'],
  },
  {
    id: 'b1',
    title: 'BMW sensor 8640112020',
    brand: 'BMW',
    partSource: 'OEM',
    mpn: '8640112020',
    oe: [],
    makes: ['BMW'],
  },
  {
    id: 'b2',
    title: 'Hella BMW sensor',
    brand: 'Hella',
    partSource: 'AFTERMARKET',
    mpn: 'HL-77777',
    oe: ['8640112021'],
    makes: ['BMW'],
  },
  {
    id: 'gone',
    title: 'Toyota lane camera (sold)',
    brand: 'Toyota',
    partSource: 'OEM',
    mpn: '86401-12020',
    oe: [],
    makes: ['Toyota'],
  },
];

type MockPart = {
  id: string;
  title: string;
  brand: string;
  partSource: string;
  mpn: string;
  oe: string[];
  makes: string[];
  specifics?: Record<string, unknown>;
};

/** Every number on a mock part, as the index and pb_part_numbers() see them. */
const numbersOf = (p: MockPart) =>
  [p.mpn, ...p.oe, ...Object.values(p.specifics ?? {}).map(String)]
    .flatMap((value) => value.split(/[,;|]+/))
    .map(normalizePartNumber)
    .filter(Boolean);

function offerRow(partId: string, status = 'ACTIVE', quantity = 1) {
  return {
    id: `o-${partId}`,
    sellerId: 'seller',
    canonicalPartId: partId,
    price: 100,
    sellerBasePrice: 80,
    currency: 'USD',
    condition: 'USED',
    partSource: 'OEM',
    qualityTier: 'USED',
    status,
    sourceTag: 'SAL',
    sourceKey: null,
    sellerSku: null,
    sellerTitle: null,
    externalOfferId: null,
    leadTimeDays: null,
    updatedAt: new Date('2026-10-27T00:00:00Z'),
    seller: {
      id: 'seller',
      name: 'Salvage Auto Parts',
      storeId: '7',
      onboardingStatus: 'ACTIVE',
    },
    inventory: quantity
      ? [
          {
            quantity,
            status: 'AVAILABLE',
            warehouse: { id: 'w', name: 'Main', location: 'Dubai' },
          },
        ]
      : [],
  };
}

function makeService(parts: MockPart[] = PARTS) {
  const prisma: any = {
    catalogPartNumber: { findMany: jest.fn().mockResolvedValue([]) },
    canonicalPart: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          parts.filter((p) => where.id.in.includes(p.id)).map((p) => ({
            id: p.id,
            title: p.title,
            brand: p.brand,
            partSource: p.partSource,
            qualityTier: 'USED',
            category: 'Electrical',
            partType: null,
            position: null,
            manufacturerPartNumber: p.mpn,
            oeNumbers: p.oe,
            itemSpecifics: p.specifics ?? null,
            imageUrls: [`https://img/${p.id}.jpg`],
            slug: null,
            partNumbers: [],
          })),
        ),
      ),
    },
    sellerOffer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.canonicalPartId.in.map((id: string) =>
            id === 'gone' ? offerRow(id, 'INACTIVE', 0) : offerRow(id),
          ),
        ),
      ),
    },
    vehicleMake: {
      findMany: jest.fn().mockResolvedValue([
        { name: 'Toyota', displayName: null },
        { name: 'BMW', displayName: null },
        { name: 'Audi', displayName: null },
      ]),
    },
    $queryRaw: jest.fn((sql: any) => {
      const text: string = sql.strings.join('?');
      const values: any[] = sql.values;
      if (text.includes('pb_part_numbers')) {
        const wanted: string[] = values[0];
        return Promise.resolve(
          parts
            .filter((p) => numbersOf(p).some((n) => wanted.includes(n)))
            .map((p) => ({ id: p.id })),
        );
      }
      if (text.includes('regexp_replace')) {
        const wanted: string[] = values[0];
        return Promise.resolve(
          parts.filter((p) => wanted.includes(normalizePartNumber(p.mpn))).map(
            (p) => ({ id: p.id }),
          ),
        );
      }
      if (text.includes('"oeNumbers" &&')) {
        const wanted: string[] = values[0];
        return Promise.resolve(
          parts.filter((p) => p.oe.some((o) => wanted.includes(o))).map(
            (p) => ({ id: p.id }),
          ),
        );
      }
      if (text.includes('jsonb_array_elements')) {
        const ids: string[] = values[0];
        return Promise.resolve(
          parts.filter((p) => ids.includes(p.id)).flatMap((p) =>
            p.makes.map((make) => ({
              id: p.id,
              make,
              model: 'Corolla',
              min_year: 2015,
              max_year: 2019,
            })),
          ),
        );
      }
      return Promise.resolve([]);
    }),
  };
  const service = new PortalOptionsService(prisma, {
    search: jest.fn(),
  } as any);
  (service as any).client = {
    indices: { existsAlias: jest.fn().mockResolvedValue({ body: true }) },
    search: jest.fn(({ body }: any) => {
      const terms: string[] | undefined = body?.query?.terms?.searchNumbers;
      const hits = terms
        ? parts.filter((p) => numbersOf(p).some((n) => terms.includes(n))).map(
            (p) => ({ _id: p.id }),
          )
        : [];
      return Promise.resolve({ body: { hits: { hits } } });
    }),
  };
  return { service, prisma };
}

const membership = (response: any) =>
  Object.fromEntries(
    response.groups.map((g: any) => [g.key, g.items.map((i: any) => i.partId)]),
  );

describe('PortalOptionsService number expansion', () => {
  it('groups exact, aftermarket and unverified equivalents, and keeps other makes out', async () => {
    const { service } = makeService();
    const response = await service.options({ q: '86401-12020' } as any);
    const groups = membership(response);

    expect(response.mode).toBe('number');
    expect(groups.exact).toEqual(['t1']);
    // Febest declares it replaces the number; the same Febest product on
    // another listing joins the same group.
    expect(groups.aftermarket_equivalent?.sort()).toEqual(['f1', 'f2']);
    // Same digits on a BMW part, and a cross-reference one hop away: shown,
    // but only as unverified possibilities.
    expect(groups.possible?.sort()).toEqual(['a1', 'b1']);
    // The BMW cross-reference reached through the Toyota OE number is excluded.
    expect(Object.values(groups).flat()).not.toContain('b2');
    expect(response.summary.excludedOtherMake).toBeGreaterThanOrEqual(1);

    const b1 = response.groups
      .find((g: any) => g.key === 'possible')!
      .items.find((i: any) => i.partId === 'b1')!;
    expect(b1.match.note).toMatch(/recorded for BMW/);
    const a1 = response.groups
      .find((g: any) => g.key === 'possible')!
      .items.find((i: any) => i.partId === 'a1')!;
    expect(a1.match.trail).toHaveLength(2);
    expect(a1.match.trail[1].text).toContain('86401-12021');
  });

  it('returns the identical result set for every separator form', async () => {
    const forms = ['86401-12020', '86401 12020', '8640112020', '86401/12020'];
    const results: Array<Record<string, string[]>> = [];
    for (const q of forms) {
      const { service } = makeService();
      results.push(membership(await service.options({ q } as any)));
    }
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });

  it('hides parts whose only offer ended unless asked, and never counts them as in stock', async () => {
    const { service } = makeService();
    const hidden = await service.options({ q: '8640112020' } as any);
    const exact = hidden.groups.find((g: any) => g.key === 'exact')!;
    expect(exact.items.map((i: any) => i.partId)).toEqual(['t1']);
    expect(exact.hiddenUnavailable).toBe(1);
    expect(hidden.summary.notAvailable).toBe(1);

    const { service: again } = makeService();
    const shown = await again.options({
      q: '8640112020',
      includeUnavailable: true,
    } as any);
    const gone = shown.groups
      .find((g: any) => g.key === 'exact')!
      .items.find((i: any) => i.partId === 'gone')!;
    expect(gone.availability.status).toBe('not_available');
  });

  it('reports a sentence summary and checks availability from Postgres', async () => {
    const { service, prisma } = makeService();
    const response = await service.options({ q: '8640112020' } as any);
    expect(prisma.sellerOffer.findMany).toHaveBeenCalled();
    expect(response.summary.sentence).toMatch(/^\d+ options: \d+ in stock/);
    expect(response.meta.audience).toBe('internal');
  });
});

describe('PortalOptionsService seller-declared superseded numbers', () => {
  // Production case (2026-10-27, BP4K-56-453B): listing item specifics carry
  // superseded numbers on ~19k parts, and one listing stores a VIN as its
  // part number. Chaining through them returned 99 "superseded" parts in 49 s.
  const MAZDA: MockPart[] = [
    { id: 'e1', title: 'Mazda 3 control arm BP4K-56-453B', brand: 'Mazda', partSource: 'OEM', mpn: 'BP4K-56-453B', oe: [], makes: ['Mazda'], specifics: { supersededPartNumber: 'BP4K-56-453D' } },
    { id: 's1', title: 'Mazda 3 control arm (newer number)', brand: 'Mazda', partSource: 'OEM', mpn: 'BP4K-56-453D', oe: [], makes: ['Mazda'] },
    { id: 'vin', title: 'Mazda 3 arm from donor car', brand: 'Mazda', partSource: 'OEM', mpn: 'JM7BK326081392088', oe: [], makes: ['Mazda'], specifics: { supersededPartNumber: 'BP4K-56-453B' } },
    { id: 'samecar', title: 'Mazda 3 door mirror from the same donor', brand: 'Mazda', partSource: 'OEM', mpn: 'JM7BK326081392088', oe: [], makes: ['Mazda'] },
    { id: 's2', title: 'Mazda 3 arm listing', brand: 'Mazda', partSource: 'OEM', mpn: 'ZZ-99999', oe: [], makes: ['Mazda'], specifics: { supersededPartNumber: 'BP4K-56-453D' } },
    { id: 'deep', title: 'Mazda part two seller hops away', brand: 'Mazda', partSource: 'OEM', mpn: 'QQ-12345', oe: [], makes: ['Mazda'], specifics: { supersededPartNumber: 'ZZ-99999' } },
  ];

  it('keeps unverified superseded numbers to one hop and never expands through a VIN', async () => {
    const { service } = makeService(MAZDA);
    const groups = membership(await service.options({ q: 'BP4K-56-453B', includeUnavailable: true } as any));
    expect(groups.exact).toEqual(['e1']);
    // The exact part's own superseded number, the listing that declares it
    // supersedes the asked number, and listings declaring the exact part's
    // superseded number: one hop, so "superseded".
    expect(groups.superseded?.sort()).toEqual(['s1', 's2', 'vin']);
    const all = Object.values(groups).flat();
    // The VIN on 'vin' is never followed to other parts of the same car.
    expect(all).not.toContain('samecar');
    // Two seller-declared hops away: at most an unverified possibility.
    expect(groups.superseded).not.toContain('deep');
  });
});
