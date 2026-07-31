import {
  buildSearchDocument,
  buyerVisibleOffers,
  listingQuality,
} from './search-document.builder';
import {
  classifyPartType,
  classifySide,
  classifyPositions,
  knownPartTypes,
} from './part-type-classifier';

const activeOffer = (over: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  sellerId: 'seller-1',
  sellerName: 'Acme Parts',
  price: 37.49,
  currency: 'USD',
  condition: 'USED',
  status: 'ACTIVE',
  sourceTag: 'SAL',
  ...over,
});

/** The real production part that exposed the empty-normalized-numbers defect. */
const salvagePart = {
  id: 'part-1',
  title: '2019 Toyota Corolla Lane Departure Camera Used OEM 8640112020',
  manufacturerPartNumber: '8640112020',
  oeNumbers: ['8640112020'],
  partNumbers: [], // no CatalogPartNumber rows — this is the 52 % case
  brand: 'Toyota',
  category: 'General',
  imageUrls: ['https://example.test/a.jpg'],
  compatibility: [{ make: 'Toyota', model: 'Corolla', yearFrom: 2019, yearTo: 2019 }],
  offers: [activeOffer()],
};

describe('searchNumbers coverage (audit RC-1)', () => {
  it('populates numbers for a part with no CatalogPartNumber rows', () => {
    // Production indexes `normalizedPartNumbers: []` for exactly this part.
    const doc = buildSearchDocument(salvagePart)!;
    expect(doc.searchNumbers).toContain('8640112020');
    expect(doc.oemNumbers).toContain('8640112020');
  });

  it('normalizes every separator form to the same key', () => {
    for (const form of ['86401-12020', '86401 12020', '86401/12020']) {
      const doc = buildSearchDocument({
        ...salvagePart,
        manufacturerPartNumber: form,
        oeNumbers: [form],
      })!;
      expect(doc.searchNumbers).toContain('8640112020');
    }
  });

  it('keeps original values for display and never searches them', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      manufacturerPartNumber: '86401-12020',
      oeNumbers: ['86401-12020'],
    })!;
    expect(doc.displayNumbers).toContain('86401-12020');
    expect(doc.searchNumbers).not.toContain('86401-12020');
  });

  it('separates numbers by role so ranking can tier them', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      partNumbers: [
        { numberType: 'BRAND_MPN', normalizedNumber: 'AAA111', displayNumber: 'AAA-111' },
        { numberType: 'OEM_CROSS_REFERENCE', normalizedNumber: 'BBB222', displayNumber: 'BBB-222' },
        { numberType: 'SUPERSEDED', normalizedNumber: 'CCC333', displayNumber: 'CCC-333' },
      ],
    })!;
    expect(doc.oemNumbers).toContain('AAA111');
    expect(doc.interchangeNumbers).toContain('BBB222');
    expect(doc.supersededNumbers).toContain('CCC333');
    // All roll up into the catch-all.
    expect(doc.searchNumbers).toEqual(
      expect.arrayContaining(['AAA111', 'BBB222', 'CCC333']),
    );
  });

  it('drops fragments too short to identify a part', () => {
    const doc = buildSearchDocument({ ...salvagePart, oeNumbers: ['A', '12'] })!;
    expect(doc.searchNumbers).not.toContain('A');
    expect(doc.searchNumbers).not.toContain('12');
  });
});

describe('buyer visibility', () => {
  it('drops inactive offers, hidden sellers, and non-positive prices', () => {
    const offers = buyerVisibleOffers({
      offers: [
        activeOffer(),
        activeOffer({ id: 'o2', status: 'INACTIVE' }),
        activeOffer({ id: 'o3', sellerId: 'seed-febest-inventory-supplier' }),
        activeOffer({ id: 'o4', sellerName: 'FEBEST Inventory Supplier' }),
        activeOffer({ id: 'o5', price: 0 }),
        activeOffer({ id: 'o6', seller: { onboardingStatus: 'PENDING' } }),
      ],
    });
    expect(offers.map((o: any) => o.id)).toEqual(['offer-1']);
  });

  it('returns null when nothing is buyer-visible, so the caller can delete', () => {
    expect(buildSearchDocument({ ...salvagePart, offers: [] })).toBeNull();
    expect(
      buildSearchDocument({ ...salvagePart, offers: [activeOffer({ status: 'INACTIVE' })] }),
    ).toBeNull();
  });
});

describe('facet fields that did not previously exist', () => {
  it('rolls condition up to part level', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      offers: [activeOffer(), activeOffer({ id: 'o2', condition: 'NEW' })],
    })!;
    expect(doc.conditions).toEqual(expect.arrayContaining(['USED', 'NEW']));
  });

  it('exposes price range, stock, image and seller facets', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      offers: [activeOffer({ price: 10 }), activeOffer({ id: 'o2', price: 90 })],
    })!;
    expect(doc.minPrice).toBe(10);
    expect(doc.maxPrice).toBe(90);
    expect(doc.hasImage).toBe(true);
    expect(doc.inStock).toBe(true);
    expect(doc.sellerIds).toEqual(['seller-1']);
    expect(doc.offerCount).toBe(2);
  });

  it('expands a compatibility year range into a year facet', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      compatibility: [{ make: 'Toyota', model: 'Corolla', yearFrom: 2017, yearTo: 2020 }],
    })!;
    expect(doc.years).toEqual([2017, 2018, 2019, 2020]);
  });

  it('rejects absurd year ranges from seller data', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      compatibility: [{ make: 'X', yearFrom: 1900, yearTo: 2100 }],
    })!;
    expect(doc.years).toEqual([]);
  });

  it('only treats A/B evidence at >=0.8 confidence as a confirmed fit', () => {
    const doc = buildSearchDocument({
      ...salvagePart,
      fitments: [
        { vehicleConfigId: 'v1', evidenceLevel: 'A', confidence: 0.95 },
        { vehicleConfigId: 'v2', evidenceLevel: 'D', confidence: 0.99 },
        { vehicleConfigId: 'v3', evidenceLevel: 'B', confidence: 0.5 },
      ],
    })!;
    expect(doc.verifiedFitments).toEqual(['v1']);
  });
});

describe('part-type classification (audit RC-5)', () => {
  it('derives a real part type from the title', () => {
    expect(classifyPartType('2019 Toyota Corolla Lane Departure Camera Used OEM')).toBe(
      'Lane Camera',
    );
    expect(classifyPartType('Mercedes-Benz tail light A2218200264')).toBe('Tail Light');
    expect(classifyPartType('Used OEM Headlight Bracket for BMW 335i')).toBe('Headlight');
  });

  it('prefers the more specific part type', () => {
    expect(classifyPartType('front brake disc rotor')).toBe('Brake Disc');
    expect(classifyPartType('brake pad set front')).toBe('Brake Pad');
  });

  it('returns null rather than a catch-all bucket', () => {
    // "General" covering 44 % of the catalogue is what made the old facet
    // useless — an unclassified part is simply absent from this facet.
    expect(classifyPartType('Assorted trim clip')).toBeNull();
    expect(classifyPartType('')).toBeNull();
  });

  it('matches whole words only', () => {
    expect(classifyPartType('cathode assembly')).toBeNull();
  });

  it('classifies side, and refuses when a title names both', () => {
    expect(classifySide('LH headlight for Audi')).toBe('LEFT');
    expect(classifySide('passenger side mirror')).toBe('RIGHT');
    expect(classifySide('LH RH pair of mirrors')).toBeNull();
    expect(classifySide('headlight assembly')).toBeNull();
  });

  it('classifies positions', () => {
    expect(classifyPositions('front upper control arm')).toEqual(
      expect.arrayContaining(['FRONT', 'UPPER']),
    );
  });

  it('exposes a stable label set', () => {
    const labels = knownPartTypes();
    expect(labels.length).toBeGreaterThan(40);
    expect(labels).toEqual([...labels].sort());
  });
});

describe('listingQuality', () => {
  it('stays within 0..1', () => {
    const rich = listingQuality(
      {
        title: 'A sufficiently long descriptive listing title here',
        description: 'x',
        manufacturerPartNumber: '1',
        brand: 'b',
        fitments: [1],
      },
      [1, 2] as any,
      true,
    );
    expect(rich).toBeLessThanOrEqual(1);
    expect(listingQuality({}, [] as any, false)).toBe(0);
  });
});

describe('robustness', () => {
  it('does not throw on malformed catalogue data', () => {
    expect(() =>
      buildSearchDocument({
        id: 'x',
        title: null,
        oeNumbers: null,
        partNumbers: null,
        compatibility: null,
        offers: [activeOffer()],
      }),
    ).not.toThrow();
  });
});
