import { flattenItemSpecifics } from './item-specifics-generator';
import {
  mapTradingEnrichmentPayload,
  normalizeItemSpecifics,
} from './realtrack-enrichment.mapper';

describe('realtrack-enrichment.mapper', () => {
  it('flattens Name/Value item specifics arrays', () => {
    const specifics = normalizeItemSpecifics([
      { name: 'Brand', value: 'Land Rover' },
      { name: 'Placement on Vehicle', values: ['Rear'] },
      { Name: 'OE/OEM Part Number', Value: ['CPLA4A213CA'] },
    ]);
    expect(specifics).toMatchObject({
      brandType: 'Land Rover',
      placementOnVehicle: 'Rear',
      oeNumber: 'CPLA4A213CA',
    });
  });

  it('maps package weight/dimensions from trading-style payload', () => {
    const mapped = mapTradingEnrichmentPayload({
      cached: true,
      itemSpecifics: { Position: 'Rear', Material: 'Steel' },
      packageWeightAndSize: {
        weight: { value: 84, unit: 'POUND' },
        dimensions: { length: 26, width: 22, height: 20, unit: 'INCH' },
      },
      description: 'Used rear differential carrier',
      imageUrls: ['https://i.ebayimg.com/x.jpg'],
    });

    expect(mapped.rawCached).toBe(true);
    expect(mapped.position).toBe('Rear');
    expect(mapped.material).toBe('Steel');
    expect(mapped.description).toContain('differential');
    expect(mapped.imageUrls).toEqual(['https://i.ebayimg.com/x.jpg']);
    expect(mapped.weightKg).toBeCloseTo(84 * 0.45359237, 3);
    expect(mapped.dimensionsCm?.lengthCm).toBeCloseTo(26 * 2.54, 2);
  });

  it('reads nested data envelopes', () => {
    const mapped = mapTradingEnrichmentPayload({
      data: {
        weightKg: 12.5,
        weightUnit: 'kg',
        itemSpecifics: [{ field: 'Part Type', value: 'Axle Carrier' }],
      },
    });
    expect(mapped.weightKg).toBe(12.5);
    expect(mapped.itemSpecifics?.partType).toBe('Axle Carrier');
  });
});

describe('flatten still works for AI path', () => {
  it('keeps FIELD_TO_KEY mapping available', () => {
    expect(flattenItemSpecifics([{ field: 'Position', value: 'Front' }])).toEqual({
      position: 'Front',
    });
  });
});
