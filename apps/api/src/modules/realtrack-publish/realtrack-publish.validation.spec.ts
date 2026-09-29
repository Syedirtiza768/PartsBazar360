import { validatePushedListing } from './realtrack-publish.validation';

const valid = () => ({
  title: 'Genuine BMW Headlight',
  price: '120.50',
  currency: 'USD',
  quantityAvailable: 2,
  imageUrls: ['https://example.com/a.jpg'],
});

describe('validatePushedListing', () => {
  it('accepts a complete listing', () => {
    expect(validatePushedListing(valid())).toBeNull();
  });

  it('accepts a listing with no quantity or currency (worker decides stock)', () => {
    const { title, price } = valid();
    expect(validatePushedListing({ title, price })).toBeNull();
  });

  it.each([
    ['missing title', { ...valid(), title: '  ' }, /title is required/],
    ['non-numeric price', { ...valid(), price: 'free' }, /price/],
    ['negative price', { ...valid(), price: -1 }, /price/],
    [
      'non-USD currency',
      { ...valid(), currency: 'AED' },
      /currency must be USD/,
    ],
    ['fractional quantity', { ...valid(), quantityAvailable: 1.5 }, /quantity/],
    ['non-array images', { ...valid(), imageUrls: 'x' }, /imageUrls/],
  ])('rejects %s', (_label, listing, message) => {
    expect(validatePushedListing(listing as Record<string, unknown>)).toMatch(
      message,
    );
  });

  it('treats an explicit zero quantity as valid (it means "ended")', () => {
    expect(
      validatePushedListing({ ...valid(), quantityAvailable: 0 }),
    ).toBeNull();
  });
});
