import { calculateRealtrackPrice } from './pricing.util';

describe('calculateRealtrackPrice', () => {
  it.each([
    [4.99, null, 'below_minimum'],
    [5, 38, null],
    [15, 38, null],
    [16, 45.99, null],
    [21, 45.99, null],
    [22, 49.99, null],
    [25, 49.99, null],
    [25.01, 50.02, null],
  ])('maps %p to %p', (cost, sellingPrice, skipReason) => {
    expect(calculateRealtrackPrice(cost)).toEqual({ sellingPrice, skipReason });
  });

  it('rejects invalid costs', () => {
    expect(calculateRealtrackPrice(Number.NaN)).toEqual({
      sellingPrice: null,
      skipReason: 'invalid_cost',
    });
  });
});
