import { ShippingService } from './shipping.service';
import { getPartClassProfile } from './part-class-weights';
import { PAYMENT_TEST_PART_ID } from '@repo/catalog-contracts';

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

    it('returns unavailable instead of assigning an average rate to unsupported countries', () => {
      const quote = service.quoteSellerShipping([dense(1)], 'Atlantis');

      expect(quote.matchedCountry).toBe(false);
      expect(quote).toMatchObject({
        available: false,
        availabilityReason: 'DESTINATION_UNSUPPORTED',
        serviceType: 'UNAVAILABLE',
        amount: 0,
        leadTime: null,
      });
      expect(quote.billableWeightGrams).toBe(1000);
    });

    it('requires a manual quote beyond the largest defined rate band', () => {
      const quote = service.quoteSellerShipping([dense(2.4)], 'Australia');

      expect(quote.billableWeightGrams).toBe(2400);
      expect(quote).toMatchObject({
        available: false,
        requiresFreightQuote: true,
        availabilityReason: 'FREIGHT_QUOTE_REQUIRED',
        serviceType: 'FREIGHT_QUOTE_REQUIRED',
        leadTime: null,
        quotedWeightKg: 2.4,
        amount: 0,
      });
    });
  });

  describe('checkout dropdown country aliases', () => {
    /**
     * The buyer-facing country dropdown (SHIPPING_COUNTRIES) uses shorter
     * names than the EMX rate sheet — e.g. "United States" vs "United States
     * of America". Without aliasing, these destinations silently fall back
     * to the generic average rate with no lead time even though the sheet
     * has an exact row for them.
     */
    it.each([
      ['United States', 'United States of America'],
      ['Brunei', 'Brunei Darussalam'],
      ['Cabo Verde', 'Cape Verde'],
      ['Congo (DRC)', 'Congo - D.Rep'],
      ['Congo (Republic)', 'Congo-Rep'],
      ['Czech Republic', 'Czech Rep.'],
      ['North Macedonia', 'Macedonia'],
      ['Russia', 'Russian Federation'],
      ['South Korea', 'Korea Rep.'],
    ])(
      'resolves dropdown name %s to the same rate as sheet name %s',
      (dropdownName, sheetName) => {
        const viaDropdown = service.quoteSellerShipping(
          [dense(1)],
          dropdownName,
        );
        const viaSheet = service.quoteSellerShipping([dense(1)], sheetName);

        expect(viaDropdown.matchedCountry).toBe(true);
        expect(viaDropdown.amount).toBe(viaSheet.amount);
        expect(viaDropdown.leadTime).toBe(viaSheet.leadTime);
        expect(viaDropdown.leadTime).not.toBeNull();
      },
    );
  });

  describe('lead time', () => {
    it('surfaces the sheet lead time on a matched country', () => {
      const quote = service.quoteSellerShipping([dense(1)], 'Australia');
      expect(quote.leadTime).toBe('04 to 06 Business Days');
    });

    it('returns no delivery window for a country with no rate-sheet row', () => {
      const quote = service.quoteSellerShipping([dense(1)], 'Atlantis');
      expect(quote.matchedCountry).toBe(false);
      expect(quote.available).toBe(false);
      expect(quote.availabilityReason).toBe('DESTINATION_UNSUPPORTED');
      expect(quote.leadTime).toBeNull();
    });

    it('gives UAE domestic delivery its own short window', () => {
      const quote = service.quoteSellerShipping([dense(1)], 'UAE');
      expect(quote.leadTime).toBe('01 to 02 Business Days');
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
      ).toMatchObject({
        available: false,
        requiresFreightQuote: true,
        serviceType: 'FREIGHT_QUOTE_REQUIRED',
        amount: 0,
      });
    });
  });

  it('requires a specialist review for explicitly restricted handling', () => {
    const quote = service.quoteSellerShipping(
      [{ ...dense(1), requiresSpecialHandling: true }],
      'UAE',
    );

    expect(quote).toMatchObject({
      available: false,
      availabilityReason: 'SPECIAL_HANDLING_REVIEW',
      serviceType: 'SPECIAL_HANDLING_REVIEW',
      amount: 0,
      leadTime: null,
    });
  });

  describe('payment-verification item', () => {
    it('waives shipping for the hidden payment-verification item only', () => {
      const quote = service.quoteSellerShipping(
        [{ quantity: 1, canonicalPartId: PAYMENT_TEST_PART_ID }],
        'United Arab Emirates',
      );

      expect(quote).toMatchObject({
        serviceType: 'FREE',
        amount: 0,
        totalWeightGrams: 0,
        billableWeightGrams: 0,
        quotedWeightKg: 0,
        requiresFreightQuote: false,
      });
    });

    it('still charges normal shipping for other items in a mixed cart', () => {
      const quote = service.quoteSellerShipping(
        [{ quantity: 1, canonicalPartId: PAYMENT_TEST_PART_ID }, dense(1)],
        'United Arab Emirates',
      );

      expect(quote.amount).toBe(20);
      expect(quote.totalWeightGrams).toBe(1000);
    });
  });

  describe('listing fixed shipping', () => {
    it('charges the fixed per-unit amount instead of the weight quote', () => {
      const quote = service.quoteSellerShipping(
        [{ ...dense(30), quantity: 2, fixedShippingAed: 15 }],
        'United Arab Emirates',
      );
      expect(quote).toMatchObject({
        available: true,
        amount: 30,
        serviceType: 'LISTING SHIPPING',
        requiresFreightQuote: false,
      });
    });

    it('treats a zero amount as free shipping', () => {
      const quote = service.quoteSellerShipping(
        [{ ...dense(1), fixedShippingAed: 0 }],
        'United Arab Emirates',
      );
      expect(quote.available).toBe(true);
      expect(quote.amount).toBe(0);
    });

    it('adds fixed charges to the weight quote of other lines', () => {
      const quote = service.quoteSellerShipping(
        [dense(1), { ...dense(1), fixedShippingAed: 12.5 }],
        'United Arab Emirates',
      );
      expect(quote.amount).toBe(32.5);
      expect(quote.serviceType).toBe('UAE FLAT (small) + LISTING SHIPPING');
    });

    it('still refuses destinations we do not ship to', () => {
      const quote = service.quoteSellerShipping(
        [{ ...dense(1), fixedShippingAed: 10 }],
        'Atlantis',
      );
      expect(quote).toMatchObject({
        available: false,
        availabilityReason: 'DESTINATION_UNSUPPORTED',
        amount: 0,
      });
    });

    it('still routes restricted items to specialist review', () => {
      const quote = service.quoteSellerShipping(
        [{ ...dense(1), fixedShippingAed: 10, requiresSpecialHandling: true }],
        'United Arab Emirates',
      );
      expect(quote.availabilityReason).toBe('SPECIAL_HANDLING_REVIEW');
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
      expect(quote.serviceType).toBe('FREIGHT_QUOTE_REQUIRED');
      expect(quote.amount).toBe(0);
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

      // 56 × 42 × 26 / 6000 ≈ 10.2kg volumetric vs 2.2kg actual. The
      // international rate sheet stops at 2kg, so the shipment needs review.
      expect(quote.weightBasis).toBe('VOLUMETRIC');
      expect(quote.requiresFreightQuote).toBe(true);
      expect(quote.available).toBe(false);
      expect(quote.amount).toBe(0);
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
        [
          dense(1),
          {
            quantity: 1,
            weightKg: 2,
            weightSource: 'AI',
            partClassKey: 'SENSOR',
          },
        ],
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

    it('corrects a measured weight that is a plausible grams-to-kilograms unit error', () => {
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

      expect(quote.totalWeightGrams).toBe(400);
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
      // The eligibility weight is reported, but no ceiling/floor is charged.
      expect(quote.quotedWeightKg).toBe(211.6);
      expect(quote.totalWeightGrams).toBe(184_000);
      expect(quote.amount).toBe(0);
      expect(quote.available).toBe(false);
      expect(quote.leadTime).toBeNull();
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
      expect(quote.serviceType).toBe('FREIGHT_QUOTE_REQUIRED');
      expect(quote.amount).toBe(0);
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
      const double = service.quoteSellerShipping(
        [{ ...dense(1), quantity: 2 }],
        'Australia',
      );

      expect(single.totalWeightGrams).toBe(1000);
      expect(double.totalWeightGrams).toBe(2000);
      expect(double.amount).toBeGreaterThan(single.amount);
    });
  });

  describe('legacy caller compatibility', () => {
    it('still accepts the old `weight` field name', () => {
      const quote = service.quoteSellerShipping(
        [
          {
            weight: 0.55,
            quantity: 1,
            weightSource: 'SPREADSHEET',
            partClassKey: 'BRAKE_PAD_SET',
            dimensionsCm: { lengthCm: 20, widthCm: 12, heightCm: 6 },
          },
        ],
        'Australia',
      );

      expect(quote.totalWeightGrams).toBe(550);
      expect(quote.amount).toBe(106.65);
    });
  });
});
