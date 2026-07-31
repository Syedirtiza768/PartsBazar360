import {
  DEFAULT_VOLUMETRIC_DIVISOR,
  deriveBillableWeight,
  isExactWeightSource,
  parseDimensionsJson,
  resolveItemWeight,
  volumetricWeightKg,
} from './billable-weight.util';
import {
  DEFAULT_PART_CLASS,
  getPartClassProfile,
  resolvePartClassKey,
} from './part-class-weights';

describe('volumetricWeightKg', () => {
  it('divides volume by the contract divisor', () => {
    // 100 × 50 × 60 = 300,000 cm³ / 6000 = 50kg.
    expect(
      volumetricWeightKg({ lengthCm: 100, widthCm: 50, heightCm: 60 }),
    ).toBe(50);
    expect(DEFAULT_VOLUMETRIC_DIVISOR).toBe(6000);
  });

  it('honours a custom divisor', () => {
    // Same volume at the IATA 5000 divisor bills 20% heavier.
    expect(
      volumetricWeightKg({ lengthCm: 100, widthCm: 50, heightCm: 60 }, 5000),
    ).toBe(60);
  });

  it('rejects incomplete or non-positive dimensions', () => {
    expect(volumetricWeightKg(null)).toBeNull();
    expect(
      volumetricWeightKg({ lengthCm: 0, widthCm: 10, heightCm: 10 }),
    ).toBeNull();
  });
});

describe('parseDimensionsJson', () => {
  it('accepts the canonical and shorthand shapes', () => {
    expect(
      parseDimensionsJson({ lengthCm: 30, widthCm: 20, heightCm: 10 }),
    ).toMatchObject({ lengthCm: 30, widthCm: 20, heightCm: 10 });

    expect(parseDimensionsJson({ l: 30, w: 20, h: 10 })).toMatchObject({
      lengthCm: 30,
    });

    expect(
      parseDimensionsJson({ length: '30', width: '20', height: '10' }),
    ).toMatchObject({ lengthCm: 30 });
  });

  it('rejects partial or malformed JSON', () => {
    expect(parseDimensionsJson({ lengthCm: 30, widthCm: 20 })).toBeNull();
    expect(parseDimensionsJson(null)).toBeNull();
    expect(parseDimensionsJson('30x20x10')).toBeNull();
  });
});

describe('resolveItemWeight', () => {
  it('falls back to the class median when weight is unknown', () => {
    const result = resolveItemWeight({ partClassKey: 'ALTERNATOR' });
    expect(result.source).toBe('CLASS_DEFAULT');
    expect(result.actualKg).toBe(getPartClassProfile('ALTERNATOR').medianWeightKg);
  });

  it('uses the global default for an unknown class', () => {
    const result = resolveItemWeight({});
    expect(result.partClassKey).toBe(DEFAULT_PART_CLASS.key);
    expect(result.actualKg).toBe(DEFAULT_PART_CLASS.medianWeightKg);
  });

  it('bills on volume when volumetric exceeds actual', () => {
    const result = resolveItemWeight({
      weightKg: 8,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BUMPER_COVER',
      dimensionsCm: { lengthCm: 165, widthCm: 55, heightCm: 38 },
    });

    // 165 × 55 × 38 / 6000 ≈ 57.5kg, far above the 8kg actual weight.
    expect(result.basis).toBe('VOLUMETRIC');
    expect(result.billableKg).toBeCloseTo(57.475, 2);
    expect(result.dimensionsEstimated).toBe(false);
  });

  it('dampens volumetric weight derived from class-default dimensions', () => {
    const withRealDims = resolveItemWeight({
      weightKg: 8,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BUMPER_COVER',
      dimensionsCm: { lengthCm: 165, widthCm: 55, heightCm: 38 },
    });
    const withGuessedDims = resolveItemWeight({
      weightKg: 8,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BUMPER_COVER',
    });

    expect(withGuessedDims.dimensionsEstimated).toBe(true);
    expect(withGuessedDims.billableKg).toBeLessThan(withRealDims.billableKg);
  });

  it('clamps estimated weights to the class envelope but trusts measurements', () => {
    const profile = getPartClassProfile('BRAKE_PAD_SET');

    const estimated = resolveItemWeight({
      weightKg: 500,
      weightSource: 'AI',
      partClassKey: 'BRAKE_PAD_SET',
    });
    expect(estimated.actualKg).toBe(profile.maxWeightKg);
    expect(estimated.clamped).toBe(true);

    // A plausible exact measurement inside the envelope is trusted.
    const measured = resolveItemWeight({
      weightKg: 3.2,
      weightSource: 'MEASURED',
      partClassKey: 'BRAKE_PAD_SET',
    });
    expect(measured.actualKg).toBe(3.2);
    expect(measured.clamped).toBe(false);
    expect(measured.outlier).toBe(false);
    expect(measured.unitAutoConverted).toBe(false);
  });

  it('auto-converts a likely grams-as-kg unit error for exact sources', () => {
    // BRAKE_PAD_SET maxWeightKg = 5. A 500kg brake pad is clearly grams.
    const result = resolveItemWeight({
      weightKg: 500,
      weightSource: 'MEASURED',
      partClassKey: 'BRAKE_PAD_SET',
    });
    expect(result.actualKg).toBe(0.5); // 500g → 0.5kg
    expect(result.unitAutoConverted).toBe(true);
    expect(result.outlier).toBe(true);
    expect(result.clamped).toBe(false); // exact sources still not clamped
  });

  it('flags a plausible outlier for exact sources but does not auto-convert', () => {
    // BRAKE_DISC_ROTOR maxWeightKg = 22. A 80kg rotor is 3.6× the max —
    // outlier territory but not a single g→kg conversion.
    const result = resolveItemWeight({
      weightKg: 80,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BRAKE_DISC_ROTOR',
    });
    expect(result.actualKg).toBe(80); // kept as-is
    expect(result.outlier).toBe(true);
    expect(result.unitAutoConverted).toBe(false);
    expect(result.clamped).toBe(false); // exact sources still not clamped
  });

  it('does not auto-convert when g→kg result would still be implausible', () => {
    // ALTERNATOR maxWeightKg = 16. 5000g → 5kg, which is in the envelope.
    const result = resolveItemWeight({
      weightKg: 5000,
      weightSource: 'MEASURED',
      partClassKey: 'ALTERNATOR',
    });
    expect(result.actualKg).toBe(5); // 5000g → 5kg
    expect(result.unitAutoConverted).toBe(true);
    expect(result.outlier).toBe(true);
  });

  it('marks normal weights as neither outlier nor auto-converted', () => {
    const result = resolveItemWeight({
      weightKg: 2,
      weightSource: 'SPREADSHEET',
      partClassKey: 'BRAKE_PAD_SET',
    });
    expect(result.outlier).toBe(false);
    expect(result.unitAutoConverted).toBe(false);
  });

  it('defaults an unlabelled supplied weight to the AI source', () => {
    expect(resolveItemWeight({ weightKg: 2 }).source).toBe('AI');
  });
});

describe('deriveBillableWeight', () => {
  it('returns null when nothing is known', () => {
    expect(deriveBillableWeight({})).toBeNull();
  });

  it('uses actual weight when no dimensions are present', () => {
    expect(deriveBillableWeight({ actualKg: 3 })).toMatchObject({
      actualKg: 3,
      volumetricKg: null,
      billableKg: 3,
      basis: 'ACTUAL',
    });
  });

  it('uses volumetric weight when it dominates', () => {
    expect(
      deriveBillableWeight({
        actualKg: 8,
        dimensionsCm: { lengthCm: 165, widthCm: 55, heightCm: 38 },
      }),
    ).toMatchObject({ basis: 'VOLUMETRIC' });
  });

  it('works from dimensions alone', () => {
    expect(
      deriveBillableWeight({
        dimensionsCm: { lengthCm: 100, widthCm: 50, heightCm: 60 },
      }),
    ).toMatchObject({ actualKg: null, billableKg: 50, basis: 'VOLUMETRIC' });
  });
});

describe('isExactWeightSource', () => {
  it('separates measurements from estimates', () => {
    expect(isExactWeightSource('SPREADSHEET')).toBe(true);
    expect(isExactWeightSource('SELLER')).toBe(true);
    expect(isExactWeightSource('MEASURED')).toBe(true);
    expect(isExactWeightSource('AI')).toBe(false);
    expect(isExactWeightSource('CLASS_DEFAULT')).toBe(false);
    expect(isExactWeightSource(null)).toBe(false);
  });
});

describe('resolvePartClassKey', () => {
  it('prefers the longest keyword match over declaration order', () => {
    // "brake pad" must win over the shorter "rotor"/"caliper" style matches.
    expect(resolvePartClassKey({ title: 'Front Brake Pad Set for BMW' })).toBe(
      'BRAKE_PAD_SET',
    );
    expect(resolvePartClassKey({ title: 'Rear Brake Disc Rotor 320mm' })).toBe(
      'BRAKE_DISC_ROTOR',
    );
  });

  it('recognises bulky body parts', () => {
    expect(resolvePartClassKey({ title: 'Front Bumper Cover Primed' })).toBe(
      'BUMPER_COVER',
    );
    expect(getPartClassProfile('BUMPER_COVER').volumetricDominant).toBe(true);
  });

  it('falls back to the category when no keyword matches', () => {
    expect(
      resolvePartClassKey({ title: 'Mystery widget XJ9', category: 'Engine' }),
    ).toBe('ENGINE_COMPONENT_GENERIC');
  });

  it('falls back to the global default when nothing is known', () => {
    expect(resolvePartClassKey({})).toBe(DEFAULT_PART_CLASS.key);
    expect(resolvePartClassKey({ title: 'Mystery widget XJ9' })).toBe(
      DEFAULT_PART_CLASS.key,
    );
  });

  it('matches German-language titles from eBay ingestion', () => {
    expect(resolvePartClassKey({ title: 'Stoßstange vorne für Audi A4' })).toBe(
      'BUMPER_COVER',
    );
    expect(resolvePartClassKey({ title: 'Lichtmaschine Generator 150A' })).toBe(
      'ALTERNATOR',
    );
  });
});
