import {
  normalizeDimensions,
  normalizeWeight,
  parseNumericCell,
  resolveShippingMetrics,
} from './weight-normalizer';

describe('parseNumericCell', () => {
  it('parses plain and European decimals', () => {
    expect(parseNumericCell('2.5')).toBe(2.5);
    expect(parseNumericCell('2,5')).toBe(2.5);
    expect(parseNumericCell(2.5)).toBe(2.5);
  });

  it('strips units and stray characters', () => {
    expect(parseNumericCell('2.5 kg')).toBe(2.5);
    expect(parseNumericCell('≈ 2,5 kg')).toBe(2.5);
  });

  it('treats grouped commas as thousands separators', () => {
    expect(parseNumericCell('1,250')).toBe(1250);
    expect(parseNumericCell('1,250.75')).toBe(1250.75);
    expect(parseNumericCell('1.250,75')).toBe(1250.75);
  });

  it('returns null for unusable cells', () => {
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('n/a')).toBeNull();
    expect(parseNumericCell(null)).toBeNull();
  });
});

describe('normalizeWeight', () => {
  it('converts each supported unit to kg', () => {
    expect(normalizeWeight({ value: '500', defaultUnit: 'g' })?.kg).toBe(0.5);
    expect(normalizeWeight({ value: '2', defaultUnit: 'lb' })?.kg).toBeCloseTo(
      0.907,
      3,
    );
    expect(normalizeWeight({ value: '16', defaultUnit: 'oz' })?.kg).toBeCloseTo(
      0.454,
      3,
    );
  });

  it('prefers a unit embedded in the cell over the job default', () => {
    const result = normalizeWeight({ value: '900 g', defaultUnit: 'kg' });
    expect(result?.kg).toBe(0.9);
    expect(result?.unitExplicit).toBe(true);
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it('flags low confidence when no unit is known anywhere', () => {
    const result = normalizeWeight({ value: '3.2' });
    expect(result?.kg).toBe(3.2);
    expect(result?.unitExplicit).toBe(false);
    expect(result?.confidence).toBeLessThan(0.5);
    expect(result?.warnings.join(' ')).toContain('assumed kg');
  });

  it('warns on implausible values', () => {
    const heavy = normalizeWeight({ value: '5000', defaultUnit: 'kg' });
    expect(heavy?.warnings.join(' ')).toContain('exceeds');
    expect(heavy?.confidence).toBeLessThanOrEqual(0.3);
  });

  it('returns null for missing or zero weights', () => {
    expect(normalizeWeight({ value: '' })).toBeNull();
    expect(normalizeWeight({ value: '0' })).toBeNull();
  });
});

describe('normalizeDimensions', () => {
  it('reads discrete columns', () => {
    const result = normalizeDimensions({
      length: '30',
      width: '20',
      height: '15',
      defaultUnit: 'cm',
    });
    expect(result).toMatchObject({ lengthCm: 30, widthCm: 20, heightCm: 15 });
  });

  it('converts mm and inches', () => {
    expect(
      normalizeDimensions({
        length: '300',
        width: '200',
        height: '150',
        defaultUnit: 'mm',
      }),
    ).toMatchObject({ lengthCm: 30, widthCm: 20, heightCm: 15 });

    expect(
      normalizeDimensions({
        length: '10',
        width: '10',
        height: '10',
        defaultUnit: 'in',
      }),
    ).toMatchObject({ lengthCm: 25.4, widthCm: 25.4, heightCm: 25.4 });
  });

  it('parses a combined dimensions cell', () => {
    expect(normalizeDimensions({ raw: '30x20x15 cm' })).toMatchObject({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      unitExplicit: true,
    });

    expect(normalizeDimensions({ raw: '300 × 200 × 150 mm' })).toMatchObject({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    });
  });

  it('prefers discrete columns over a combined cell', () => {
    const result = normalizeDimensions({
      length: '40',
      width: '30',
      height: '20',
      raw: '1x1x1 cm',
      defaultUnit: 'cm',
    });
    expect(result).toMatchObject({ lengthCm: 40, widthCm: 30, heightCm: 20 });
  });

  it('returns null when a dimension is missing', () => {
    expect(normalizeDimensions({ length: '30', width: '20' })).toBeNull();
    expect(normalizeDimensions({ raw: '30x20' })).toBeNull();
  });
});

describe('resolveShippingMetrics', () => {
  it('prefers gross weight over net, since carriers bill the packed parcel', () => {
    const result = resolveShippingMetrics({
      netWeight: '1.2',
      grossWeight: '1.6',
      defaultWeightUnit: 'kg',
    });
    expect(result.weightKg).toBe(1.6);
  });

  it('falls back to net weight when gross is absent', () => {
    const result = resolveShippingMetrics({
      netWeight: '1.2',
      defaultWeightUnit: 'kg',
    });
    expect(result.weightKg).toBe(1.2);
  });

  it('collects dimensions and surfaces warnings', () => {
    const result = resolveShippingMetrics({
      netWeight: '2',
      length: '30',
      width: '20',
      height: '15',
    });

    expect(result.weightKg).toBe(2);
    expect(result.dimensionsCm).toMatchObject({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    });
    // Neither unit was supplied, so both assumptions are reported.
    expect(result.warnings.length).toBe(2);
  });

  it('returns nulls when the row has no shipping data at all', () => {
    const result = resolveShippingMetrics({});
    expect(result.weightKg).toBeNull();
    expect(result.dimensionsCm).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});
