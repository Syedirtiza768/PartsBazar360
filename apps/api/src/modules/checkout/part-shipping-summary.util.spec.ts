import { buildPartShippingSummary } from './part-shipping-summary.util';

describe('buildPartShippingSummary', () => {
  it('reports exact when weight and dimensions are both measured', () => {
    const summary = buildPartShippingSummary({
      title: 'Front Brake Pad Set for BMW 3 Series',
      category: 'Brakes',
      weight: 1.6,
      weightSource: 'SPREADSHEET',
      weightConfidence: 0.95,
      dimensions: { lengthCm: 22, widthCm: 14, heightCm: 8 },
    });

    expect(summary).toMatchObject({
      state: 'exact',
      weightKg: 1.6,
      billableWeightKg: 1.6,
      weightBasis: 'ACTUAL',
      source: 'SPREADSHEET',
      confidence: 0.95,
      dimensionsEstimated: false,
      requiresFreightQuote: false,
    });
  });

  it('downgrades to estimated when dimensions are missing', () => {
    const summary = buildPartShippingSummary({
      title: 'Front Brake Pad Set',
      category: 'Brakes',
      weight: 1.6,
      weightSource: 'SPREADSHEET',
    });

    // An exact mass with guessed dimensions still yields an estimated
    // volumetric weight, so the summary must not claim to be exact.
    expect(summary.state).toBe('estimated');
    expect(summary.dimensionsEstimated).toBe(true);
  });

  it('always returns a usable weight for a bare part', () => {
    const summary = buildPartShippingSummary({
      title: 'Alternator 150A for Nissan Patrol',
      category: 'Electrical',
    });

    expect(summary.state).toBe('estimated');
    expect(summary.source).toBe('CLASS_DEFAULT');
    expect(summary.partClassKey).toBe('ALTERNATOR');
    expect(summary.billableWeightKg).toBeGreaterThan(0);
  });

  it('reports pending while enrichment is in flight', () => {
    for (const status of ['QUEUED', 'RUNNING']) {
      expect(
        buildPartShippingSummary({
          title: 'Mystery widget',
          enrichmentStatus: status,
        }).state,
      ).toBe('pending');
    }
  });

  it('does not report pending once a measurement exists', () => {
    expect(
      buildPartShippingSummary({
        title: 'Front Brake Pad Set',
        category: 'Brakes',
        weight: 1.6,
        weightSource: 'MEASURED',
        dimensions: { lengthCm: 22, widthCm: 14, heightCm: 8 },
        enrichmentStatus: 'RUNNING',
      }).state,
    ).toBe('exact');
  });

  it('flags oversized parts for a freight quote', () => {
    const summary = buildPartShippingSummary({
      title: 'Complete Engine Assembly for Ford F-150 5.0L',
      category: 'Engine',
    });

    expect(summary.requiresFreightQuote).toBe(true);
    expect(summary.billableWeightKg).toBeGreaterThan(30);
  });

  it('surfaces volumetric basis for bulky parts', () => {
    const summary = buildPartShippingSummary({
      title: 'Tail Light Rear Right for Toyota Corolla',
      category: 'Electrical',
      weight: 2.2,
      weightSource: 'SPREADSHEET',
      dimensions: { lengthCm: 56, widthCm: 42, heightCm: 26 },
    });

    expect(summary.weightBasis).toBe('VOLUMETRIC');
    expect(summary.billableWeightKg).toBeGreaterThan(summary.weightKg);
  });

  it('hides confidence for estimated weights', () => {
    expect(
      buildPartShippingSummary({
        title: 'Mystery widget',
        weight: 3,
        weightSource: 'AI',
        weightConfidence: 0.7,
      }).confidence,
    ).toBeNull();
  });

  it('prefers a stored class key over re-resolving from the title', () => {
    expect(
      buildPartShippingSummary({
        title: 'Front Brake Pad Set',
        category: 'Brakes',
        partClassKey: 'ALTERNATOR',
      }).partClassKey,
    ).toBe('ALTERNATOR');
  });
});
