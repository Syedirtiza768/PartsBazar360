import {
  isImportableListing,
  listingQuantity,
  MARKETPLACE_CURRENCY,
} from './listing-eligibility.util';

describe('listing eligibility', () => {
  it('rejects zero stock and inactive statuses', () => {
    expect(isImportableListing({ listingStatus: 'ACTIVE', quantityAvailable: 0 })).toBe(false);
    expect(isImportableListing({ listingStatus: 'ENDED', quantityAvailable: 5 })).toBe(false);
    expect(isImportableListing({ listingStatus: 'ACTIVE', quantityAvailable: 2 })).toBe(true);
    expect(listingQuantity({ quantityAvailable: 0 })).toBe(0);
  });

  it('allows published listings with unknown quantity', () => {
    expect(isImportableListing({ listingStatus: 'PUBLISHED' })).toBe(true);
    expect(MARKETPLACE_CURRENCY).toBe('USD');
  });
});
