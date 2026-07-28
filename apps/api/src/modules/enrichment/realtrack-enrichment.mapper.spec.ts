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

  it('maps the verified live trading-enrichment envelope', () => {
    const mapped = mapTradingEnrichmentPayload({
      data: {
        enrichedAt: '2026-07-28T23:32:23.960Z',
        source: 'trading_api',
        imageUrls: ['https://i.ebayimg.com/a.jpg', 'https://i.ebayimg.com/b.jpg'],
        compatibility: {
          compatibleProducts: [
            {
              compatibilityProperties: [
                { name: 'Year', value: '2007' },
                { name: 'Make', value: 'Mercedes-Benz' },
              ],
            },
          ],
        },
        description: '&lt;div&gt;Used OEM part&lt;/div&gt;',
        itemSpecifics: {
          Brand: ['Mercedes-Benz'],
          'Manufacturer Part Number': ['A2045461243'],
          'OE/OEM Part Number': ['A2045461243', '2045461243'],
          Placement: ['Front Left'],
        },
      },
      cached: true,
      budget: { used: 41, remaining: 4459, limit: 4500, resetDate: '2026-07-28' },
    });

    expect(mapped.rawCached).toBe(true);
    expect(mapped.budgetRemaining).toBe(4459);
    expect(mapped.brand).toBe('Mercedes-Benz');
    expect(mapped.manufacturerPartNumber).toBe('A2045461243');
    expect(mapped.oeNumbers).toEqual(
      expect.arrayContaining(['A2045461243', '2045461243']),
    );
    expect(mapped.position).toBe('Front Left');
    expect(mapped.description).toBe('<div>Used OEM part</div>');
    expect(mapped.imageUrls).toHaveLength(2);
    expect(mapped.compatibility).toMatchObject({
      compatibleProducts: expect.any(Array),
    });
  });
});

describe('flatten still works for AI path', () => {
  it('keeps FIELD_TO_KEY mapping available', () => {
    expect(flattenItemSpecifics([{ field: 'Position', value: 'Front' }])).toEqual({
      position: 'Front',
    });
  });
});
