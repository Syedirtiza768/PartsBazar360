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
});
