import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { RealtrackSearchGuard } from './internal-search.guard';
import {
  InternalSearchService,
  MAX_OFFERS_PER_RESULT,
  toInternalOffers,
} from './internal-search.service';

function contextWith(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as any;
}

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    sellerId: 'seller-a',
    canonicalPartId: 'part-1',
    price: 50,
    sellerBasePrice: 40,
    currency: 'USD',
    condition: 'USED',
    partSource: 'OEM',
    qualityTier: 'USED',
    status: 'ACTIVE',
    sourceTag: 'BLK',
    sourceKey: 'realtrack:store-1:123',
    sellerSku: 'SKU-1',
    sellerTitle: 'Seller title',
    externalOfferId: '123',
    leadTimeDays: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    seller: {
      id: 'seller-a',
      name: 'Acme Parts',
      storeId: 'store-1',
      onboardingStatus: 'ACTIVE',
    },
    inventory: [
      {
        quantity: 2,
        status: 'AVAILABLE',
        warehouse: { id: 'wh-1', name: 'Main', location: 'Dubai' },
      },
      {
        quantity: 3,
        status: 'AVAILABLE',
        warehouse: { id: 'wh-2', name: 'Overflow', location: null },
      },
    ],
    ...overrides,
  } as any;
}

describe('RealtrackSearchGuard', () => {
  const original = process.env.REALTRACK_SEARCH_API_KEY;
  afterEach(() => {
    process.env.REALTRACK_SEARCH_API_KEY = original;
  });

  it('is off (503), not open, when the key is unset', () => {
    delete process.env.REALTRACK_SEARCH_API_KEY;
    expect(() =>
      new RealtrackSearchGuard().canActivate(contextWith({})),
    ).toThrow(ServiceUnavailableException);
  });

  it('accepts the key as a bearer token or x-api-key', () => {
    process.env.REALTRACK_SEARCH_API_KEY = 'secret-key';
    const guard = new RealtrackSearchGuard();
    expect(
      guard.canActivate(contextWith({ authorization: 'Bearer secret-key' })),
    ).toBe(true);
    expect(guard.canActivate(contextWith({ 'x-api-key': 'secret-key' }))).toBe(
      true,
    );
  });

  it('rejects a missing or wrong key', () => {
    process.env.REALTRACK_SEARCH_API_KEY = 'secret-key';
    const guard = new RealtrackSearchGuard();
    expect(() => guard.canActivate(contextWith({}))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(contextWith({ authorization: 'Bearer secret-kez' })),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(contextWith({ authorization: 'Bearer short' })),
    ).toThrow(UnauthorizedException);
  });

  it('does not accept the publishing key', () => {
    process.env.REALTRACK_SEARCH_API_KEY = 'search-key';
    process.env.REALTRACK_PUSH_API_KEY = 'push-key';
    expect(() =>
      new RealtrackSearchGuard().canActivate(
        contextWith({ authorization: 'Bearer push-key' }),
      ),
    ).toThrow(UnauthorizedException);
  });
});

describe('toInternalOffers', () => {
  it('sums stock across warehouses and keeps seller/source fields', () => {
    const [offer] = toInternalOffers([offerRow()]);
    expect(offer.quantity).toBe(5);
    expect(offer.warehouses).toHaveLength(2);
    expect(offer).toMatchObject({
      sellerName: 'Acme Parts',
      sellerStoreId: 'store-1',
      sourceTag: 'BLK',
      sourceKey: 'realtrack:store-1:123',
      sellerSku: 'SKU-1',
      sellerBasePrice: 40,
      buyerVisible: true,
      outrankedBySuperior: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('marks paused offers and inactive sellers as not buyer-visible', () => {
    const offers = toInternalOffers([
      offerRow({ id: 'paused', status: 'PAUSED' }),
      offerRow({
        id: 'draft-seller',
        seller: {
          id: 'seller-b',
          name: 'Draft Seller',
          storeId: null,
          onboardingStatus: 'DRAFT',
        },
      }),
      offerRow({ id: 'free', price: 0 }),
    ]);
    expect(offers.every((offer) => !offer.buyerVisible)).toBe(true);
    expect(offers).toHaveLength(3);
  });

  it('flags Blackline as outranked when Superior offers the same part', () => {
    const offers = toInternalOffers([
      offerRow({
        id: 'blackline',
        sellerId: 'seller-blackline-auto-parts',
        price: 10,
        seller: {
          id: 'seller-blackline-auto-parts',
          name: 'Blackline Auto Parts',
          storeId: null,
          onboardingStatus: 'ACTIVE',
        },
      }),
      offerRow({
        id: 'superior',
        sellerId: 'seller-superior-auto-parts',
        price: 90,
        seller: {
          id: 'seller-superior-auto-parts',
          name: 'Superior Auto Parts',
          storeId: null,
          onboardingStatus: 'ACTIVE',
        },
      }),
    ]);
    const blackline = offers.find((offer) => offer.id === 'blackline')!;
    const superior = offers.find((offer) => offer.id === 'superior')!;
    expect(blackline).toMatchObject({
      buyerVisible: false,
      outrankedBySuperior: true,
    });
    expect(superior.buyerVisible).toBe(true);
    // Buyer-visible offers sort first even when they are more expensive.
    expect(offers[0].id).toBe('superior');
  });
});

describe('InternalSearchService.search', () => {
  it('runs the v1 search and attaches every offer from Postgres', async () => {
    const v1 = {
      search: jest.fn().mockResolvedValue({
        query: { original: 'x', normalized: 'x', interpreted: {} },
        results: [
          { id: 'part-1', title: 'One' },
          { id: 'part-2', title: 'Two' },
        ],
        facets: {},
        appliedFilters: {},
        pagination: {
          page: 1,
          pageSize: 24,
          totalResults: 2,
          totalRelation: 'eq',
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        corrections: [],
        meta: { tookMs: 3, index: 'parts_search', degraded: false },
        requestId: 'r1',
      }),
    };
    const many = Array.from({ length: MAX_OFFERS_PER_RESULT + 5 }, (_, i) =>
      offerRow({ id: `o${i}`, price: 10 + i }),
    );
    const prisma = {
      sellerOffer: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            ...many,
            offerRow({ id: 'p2', canonicalPartId: 'part-2', status: 'ENDED' }),
          ]),
      },
    };
    const service = new InternalSearchService(v1 as any, prisma as any);

    const response = await service.search({ q: 'x' } as any);

    expect(prisma.sellerOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { canonicalPartId: { in: ['part-1', 'part-2'] } },
      }),
    );
    expect(response.meta.audience).toBe('internal');
    expect(response.results[0].internalOffers).toHaveLength(
      MAX_OFFERS_PER_RESULT,
    );
    expect(response.results[0].internalOfferCount).toBe(
      MAX_OFFERS_PER_RESULT + 5,
    );
    expect(response.results[1].internalOffers[0]).toMatchObject({
      id: 'p2',
      status: 'ENDED',
      buyerVisible: false,
    });
  });

  it('skips the database when there are no results', async () => {
    const v1 = {
      search: jest.fn().mockResolvedValue({
        results: [],
        meta: { tookMs: 1, index: 'parts_search', degraded: true },
      }),
    };
    const prisma = { sellerOffer: { findMany: jest.fn() } };
    const service = new InternalSearchService(v1 as any, prisma as any);
    const response = await service.search({} as any);
    expect(prisma.sellerOffer.findMany).not.toHaveBeenCalled();
    expect(response.meta).toMatchObject({
      degraded: true,
      audience: 'internal',
    });
  });
});
