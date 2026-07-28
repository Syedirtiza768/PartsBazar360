import { ShippingService } from './shipping.service';

describe('ShippingService', () => {
  const service = new ShippingService();

  it('uses the exact rate-sheet country and next billable band', () => {
    const quote = service.quoteSellerShipping(
      [{ weight: 0.55, quantity: 1 }],
      'Australia',
    );

    expect(quote).toMatchObject({
      destinationCountry: 'Australia',
      currency: 'AED',
      matchedCountry: true,
      totalWeightGrams: 550,
      billableWeightGrams: 600,
      amount: 106.65,
    });
  });

  it('falls back to the sheet average for unsupported countries', () => {
    const quote = service.quoteSellerShipping(
      [{ weight: 1, quantity: 1 }],
      'Atlantis',
    );

    expect(quote.matchedCountry).toBe(false);
    expect(quote.amount).toBeGreaterThan(0);
    expect(quote.billableWeightGrams).toBe(1000);
  });

  it('extends heavier parcels beyond the largest defined band', () => {
    const quote = service.quoteSellerShipping(
      [{ weight: 2.4, quantity: 1 }],
      'Australia',
    );

    expect(quote.billableWeightGrams).toBe(2400);
    expect(quote.amount).toBe(383.4);
  });

  it('applies UAE flat rates by size tier', () => {
    expect(
      service.quoteSellerShipping([{ weight: 1, quantity: 1 }], 'UAE'),
    ).toMatchObject({
      matchedCountry: true,
      serviceType: 'UAE FLAT (small)',
      amount: 20,
    });

    expect(
      service.quoteSellerShipping(
        [{ weight: 5, quantity: 1 }],
        'United Arab Emirates',
      ),
    ).toMatchObject({
      matchedCountry: true,
      serviceType: 'UAE FLAT (medium)',
      amount: 50,
    });

    expect(
      service.quoteSellerShipping([{ weight: 20, quantity: 1 }], 'AE'),
    ).toMatchObject({
      matchedCountry: true,
      serviceType: 'UAE FLAT (large)',
      amount: 75,
    });

    expect(
      service.quoteSellerShipping([{ weight: 40, quantity: 1 }], 'Emirates'),
    ).toMatchObject({
      matchedCountry: true,
      serviceType: 'UAE FLAT (heavy)',
      amount: 150,
    });
  });

  it('treats missing weight as 1kg for UAE small tier', () => {
    const quote = service.quoteSellerShipping(
      [{ quantity: 1 }],
      'United Arab Emirates',
    );
    expect(quote).toMatchObject({
      totalWeightGrams: 1000,
      amount: 20,
      serviceType: 'UAE FLAT (small)',
    });
  });
});
