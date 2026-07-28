import { ShippingService } from './shipping.service';
import { getPartClassProfile } from './part-class-weights';

describe('ShippingService', () => {
  const service = new ShippingService();

  /** Dense, small part: volumetric never wins, so rates match the legacy sheet. */
  const dense = (weightKg: number) => ({
    weightKg,
    quantity: 1,
    weightSource: 'SPREADSHEET' as const,
    partClassKey: 'BRAKE_PAD_SET',
    dimensionsCm: { lengthCm: 20, widthCm: 12, heightCm: 6 },
  });

  describe('rate sheet lookup', () => {
    it('uses the exact rate-sheet country and next billable band', () => {
      const quote = service.quoteSellerShipping([dense(0.55)], 'Australia');

      expect(quote).toMatchObject({
        destinationCountry: 'Australia',
        currency: 'AED',
        matchedCountry: true,
        totalWeightGrams: 550,
        billableWeightGrams: 600,
        amount: 106.65,
        weightBasis: 'ACTUAL',
        estimated: false,
        marginPct: 0,
      });
    });

    it('falls back to the sheet average for unsupported countries', () => {
      const quote = service.quoteSellerShipping([dense(1)], 'Atlantis');

      expect(quote.matchedCountry).toBe(false);
      expect(quote.amount).toBeGreaterThan(0);
      expect(quote.billableWeightGrams).toBe(1000);
    });

    it('extends heavier parcels beyond the largest defined band', () => {
      const quote = service.quoteSellerShipping([dense(2.4)], 'Australia');

      expect(quote.billableWeightGrams).toBe(2400);
      expect(quote.amount).toBe(383.4);
    });
  });

  describe('UAE flat tiers', () => {
    it('applies flat rates by size tier', () => {
      expect(service.quoteSellerShipping([dense(1)], 'UAE')).toMatchObject({
        matchedCountry: true,
        serviceType: 'UAE FLAT (small)',
        amount: 20,
      });

      expect(
        service.quoteSellerShipping([dense(5)], 'United Arab Emirates'),
      ).toMatchObject({ serviceType: 'UAE FLAT (medium)', amount: 50 });

      expect(service.quoteSellerShipping([dense(20)], 'AE')).toMatchObject({
        serviceType: 'UAE FLAT (large)',
        amount: 75,
      });

      expect(
        service.quoteSellerShipping([dense(40)], 'Emirates'),
      ).toMatchObject({ serviceType: 'UAE FLAT (heavy)', amount: 150 });
    });
  });

  describe('volumetric weight', () => {
    it('bills a bumper on volume rather than its actual mass', () => {
      const profile = getPartClassProfile('BUMPER_COVER');
      const quote = service.quoteSellerShipping(
        [
          {
            weightKg: 8,
            quantity: 1,
            weightSource: 'SPREADSHEET',
            partClassKey: 'BUMPER_COVER',
            dimensionsCm: { lengthCm: 165, widthCm: 55, heightCm: 38 },
          },
        ],
        'United Arab Emirates',
      );

      // 165 × 55 × 38 / 6000 ≈ 57kg volumetric vs 8kg actual, so volume wins by
      // a wide margin — and a parcel that size is freight, not courier.
      expect(profile.volumetricDominant).toBe(true);
      expect(quote.weightBasis).toBe('VOLUMETRIC');
      expect(quote.totalWeightGrams).toBe(8000);
      expect(quote.requiresFreightQuote).toBe(true);
      expect(quote.serviceType).toBe('UAE FLAT (heavy)');
      expect(quote.amount).toBe(150);
    });

    it('bills a mid-size bulky part on volume without tripping freight', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            weightKg: 2.2,
            quantity: 1,
            weightSource: 'SPREADSHEET',
            partClassKey: 'TAIL_LIGHT',
            dimensionsCm: { lengthCm: 56, widthCm: 42, heightCm: 26 },
          },
        ],
        'Australia',
      );

      // 56 × 42 × 26 / 6000 ≈ 10.2kg volumetric vs 2.2kg actual.
      expect(quote.weightBasis).toBe('VOLUMETRIC');
      expect(quote.requiresFreightQuote).toBe(false);
      expect(quote.billableWeightGrams).toBeGreaterThan(10_000);
    });

    it('keeps actual weight for dense parts even with dimensions present', () => {
      const quote = service.quoteSellerShipping([dense(1.6)], 'Australia');

      expect(quote.weightBasis).toBe('ACTUAL');
      expect(quote.totalWeightGrams).toBe(1600);
    });
  });

  describe('missing weight', () => {
    it('uses the part-class median instead of a flat 1kg', () => {
      const quote = service.quoteSellerShipping(
        [{ quantity: 1, partClassKey: 'ALTERNATOR' }],
        'United Arab Emirates',
      );

      const profile = getPartClassProfile('ALTERNATOR');
      expect(profile.medianWeightKg).toBe(5.8);
      expect(quote.totalWeightGrams).toBe(5800);
      expect(quote.weightSource).toBe('CLASS_DEFAULT');
      expect(quote.estimated).toBe(true);
      // 5.8kg + margin lands in the medium tier, not the legacy small tier.
      expect(quote.serviceType).toBe('UAE FLAT (medium)');
      expect(quote.amount).toBe(50);
    });

    it('no longer quotes an unknown part at the 1kg small tier', () => {
      const quote = service.quoteSellerShipping(
        [{ quantity: 1 }],
        'United Arab Emirates',
      );

      // Global fallback is 4kg, deliberately above the old 1kg assumption.
      expect(quote.totalWeightGrams).toBe(4000);
      expect(quote.billableWeightGrams).toBeGreaterThan(1000);
      expect(quote.weightSource).toBe('CLASS_DEFAULT');
    });

    it('applies the safety margin only to estimated weights', () => {
      const estimated = service.quoteSellerShipping(
        [{ quantity: 1, partClassKey: 'BRAKE_PAD_SET' }],
        'Australia',
      );
      expect(estimated.marginPct).toBeGreaterThan(0);
      expect(estimated.estimated).toBe(true);

      const measured = service.quoteSellerShipping([dense(1.6)], 'Australia');
      expect(measured.marginPct).toBe(0);
      expect(measured.estimated).toBe(false);
    });
  });

  describe('weight source trust', () => {
    it('reports the weakest source across the cart', () => {
      const quote = service.quoteSellerShipping(
        [dense(1), { quantity: 1, weightKg: 2, weightSource: 'AI', partClassKey: 'SENSOR' }],
        'Australia',
      );

      expect(quote.weightSource).toBe('AI');
      expect(quote.estimated).toBe(true);
    });

    it('clamps an implausible AI weight into the class envelope', () => {
      const profile = getPartClassProfile('BRAKE_PAD_SET');
      const quote = service.quoteSellerShipping(
        [
          {
            quantity: 1,
            weightKg: 400,
            weightSource: 'AI',
            partClassKey: 'BRAKE_PAD_SET',
            dimensionsCm: { lengthCm: 22, widthCm: 14, heightCm: 8 },
          },
        ],
        'United Arab Emirates',
      );

      expect(quote.totalWeightGrams).toBe(profile.maxWeightKg * 1000);
    });

    it('trusts a measured weight outside the class envelope', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            quantity: 1,
            weightKg: 400,
            weightSource: 'MEASURED',
            partClassKey: 'BRAKE_PAD_SET',
            dimensionsCm: { lengthCm: 22, widthCm: 14, heightCm: 8 },
          },
        ],
        'United Arab Emirates',
      );

      expect(quote.totalWeightGrams).toBe(400_000);
    });
  });

  describe('freight ceiling', () => {
    it('does not extrapolate the 2kg rate sheet into freight weights', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            quantity: 1,
            weightKg: 184,
            weightSource: 'MEASURED',
            partClassKey: 'ENGINE_ASSEMBLY',
          },
        ],
        'Australia',
      );

      expect(quote.requiresFreightQuote).toBe(true);
      // Priced at the 30kg courier ceiling, not 184kg of linear extrapolation.
      expect(quote.quotedWeightKg).toBe(30);
      expect(quote.totalWeightGrams).toBe(184_000);
      expect(quote.amount).toBeLessThan(6000);
    });

    it('flags oversized UAE parcels too', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            quantity: 1,
            weightKg: 184,
            weightSource: 'MEASURED',
            partClassKey: 'ENGINE_ASSEMBLY',
          },
        ],
        'United Arab Emirates',
      );

      expect(quote.requiresFreightQuote).toBe(true);
      expect(quote.serviceType).toBe('UAE FLAT (heavy)');
    });

    it('leaves normal parcels unflagged', () => {
      expect(
        service.quoteSellerShipping([dense(1.6)], 'Australia')
          .requiresFreightQuote,
      ).toBe(false);
    });

    it('flags a cart that only exceeds the ceiling in aggregate', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            quantity: 4,
            weightKg: 9,
            weightSource: 'MEASURED',
            partClassKey: 'ALLOY_WHEEL',
            dimensionsCm: { lengthCm: 50, widthCm: 50, heightCm: 25 },
          },
        ],
        'Australia',
      );

      expect(quote.requiresFreightQuote).toBe(true);
    });
  });

  describe('quantity', () => {
    it('multiplies billable weight by line quantity', () => {
      const single = service.quoteSellerShipping([dense(1)], 'Australia');
      const triple = service.quoteSellerShipping(
        [{ ...dense(1), quantity: 3 }],
        'Australia',
      );

      expect(single.totalWeightGrams).toBe(1000);
      expect(triple.totalWeightGrams).toBe(3000);
      expect(triple.amount).toBeGreaterThan(single.amount);
    });
  });

  describe('legacy caller compatibility', () => {
    it('still accepts the old `weight` field name', () => {
      const quote = service.quoteSellerShipping(
        [{ weight: 0.55, quantity: 1, weightSource: 'SPREADSHEET', partClassKey: 'BRAKE_PAD_SET', dimensionsCm: { lengthCm: 20, widthCm: 12, heightCm: 6 } }],
        'Australia',
      );

      expect(quote.totalWeightGrams).toBe(550);
      expect(quote.amount).toBe(106.65);
    });
  });
});
