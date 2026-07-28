/**
 * Not an assertion suite — prints a before/after quote comparison for
 * representative parts so the revenue impact of volumetric weight and part-class
 * defaults is visible. Run with:
 *   npx jest quote-impact.demo --verbose
 */
import { ShippingService } from './shipping.service';
import { resolvePartClassKey } from './part-class-weights';

/** The legacy engine: actual weight only, unknown weight billed as exactly 1kg. */
function legacyQuote(
  service: ShippingService,
  weightKg: number | null,
  country: string,
) {
  return service.quoteSellerShipping(
    [
      {
        quantity: 1,
        weightKg: weightKg ?? 1,
        weightSource: 'MEASURED',
        dimensionsCm: { lengthCm: 1, widthCm: 1, heightCm: 1 },
      },
    ],
    country,
  );
}

describe('quote impact (informational)', () => {
  const service = new ShippingService();

  const samples: Array<{
    title: string;
    category: string;
    actualKg: number | null;
    dims: { lengthCm: number; widthCm: number; heightCm: number } | null;
  }> = [
    {
      title: 'Front Bumper Cover Primed for Toyota Camry 2018',
      category: 'Body',
      actualKg: 8,
      dims: { lengthCm: 165, widthCm: 55, heightCm: 38 },
    },
    {
      title: 'Front Brake Pad Set for BMW 3 Series',
      category: 'Brakes',
      actualKg: 1.6,
      dims: { lengthCm: 22, widthCm: 14, heightCm: 8 },
    },
    {
      title: 'Alternator 150A for Nissan Patrol',
      category: 'Electrical',
      actualKg: null,
      dims: null,
    },
    {
      title: 'Headlight Assembly LED Right for Audi A4',
      category: 'Electrical',
      actualKg: null,
      dims: null,
    },
    {
      title: 'Complete Engine Assembly for Ford F-150 5.0L',
      category: 'Engine',
      actualKg: null,
      dims: null,
    },
    {
      title: 'Oxygen Sensor Upstream for Honda Civic',
      category: 'Exhaust',
      actualKg: null,
      dims: null,
    },
  ];

  it('prints legacy vs current quotes', () => {
    for (const country of ['United Arab Emirates', 'Australia']) {
      const rows = samples.map((sample) => {
        const partClassKey = resolvePartClassKey({
          title: sample.title,
          category: sample.category,
        });
        const before = legacyQuote(service, sample.actualKg, country);
        const after = service.quoteSellerShipping(
          [
            {
              quantity: 1,
              weightKg: sample.actualKg,
              weightSource: sample.actualKg ? 'SPREADSHEET' : null,
              dimensionsCm: sample.dims,
              partClassKey,
            },
          ],
          country,
        );

        return {
          part: sample.title.slice(0, 42),
          class: partClassKey,
          beforeKg: before.billableWeightGrams / 1000,
          afterKg: after.billableWeightGrams / 1000,
          beforeAed: before.amount,
          afterAed: after.amount,
          uplift:
            before.amount > 0
              ? `${Math.round(((after.amount - before.amount) / before.amount) * 100)}%`
              : 'n/a',
          basis: after.weightBasis,
          source: after.weightSource,
          freight: after.requiresFreightQuote ? 'FREIGHT' : '',
        };
      });

      if (process.env.SHOW_QUOTE_IMPACT) {
        console.log(`\n=== ${country} ===`);
        console.table(rows);
      }
    }

    expect(samples.length).toBeGreaterThan(0);
  });
});
