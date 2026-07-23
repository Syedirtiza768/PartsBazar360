import {
  prioritizeEbayImages,
  isEbayImageUrl,
  extractListingImages,
  extractListingDescription,
  extractListingBrand,
  extractListingOeNumbers,
} from './listing-enrichment.util';

describe('prioritizeEbayImages', () => {
  it('puts ebay URLs first and keeps remote URLs only', () => {
    const result = prioritizeEbayImages([
      'https://cdn.example.com/a.jpg',
      'https://i.ebayimg.com/images/g/abc/s-l64.jpg',
      'https://static.gridxconnect.com/b.png',
      'https://i.ebayimg.com/images/g/def/s-l300.jpg',
      'not-a-url',
    ]);
    expect(result[0]).toContain('ebayimg');
    expect(result[1]).toContain('ebayimg');
    expect(result[0]).toContain('s-l1600');
    expect(result.some((u) => u.includes('example.com'))).toBe(true);
    expect(result.some((u) => u === 'not-a-url')).toBe(false);
  });

  it('detects ebay image hosts', () => {
    expect(isEbayImageUrl('https://i.ebayimg.com/images/g/x/s-l1600.jpg')).toBe(true);
    expect(isEbayImageUrl('https://static.febest.de/images/big/x.jpg')).toBe(false);
  });
});

describe('extractListingImages', () => {
  it('collects listing imageUrls and prioritizes ebay', () => {
    const urls = extractListingImages({
      imageUrls: [
        'https://cdn.other.com/1.jpg',
        'https://i.ebayimg.com/images/g/x/s-l64.jpg',
      ],
    });
    expect(urls[0]).toContain('ebay');
    expect(urls).toHaveLength(2);
  });

  it('reads structured images gallery and upgrades thumbs', () => {
    const urls = extractListingImages({
      images: [
        { url: 'https://cdn.other.com/1.jpg', sortOrder: 2, source: 'gridx' },
        { url: 'https://i.ebayimg.com/images/g/x/s-l140.jpg', sortOrder: 1, source: 'ebay' },
      ],
    });
    expect(urls[0]).toContain('ebay');
    expect(urls[0]).toContain('s-l1600');
  });
});

describe('extractListingDescription / brand / oeNumbers', () => {
  it('prefers descriptionHtml', () => {
    expect(
      extractListingDescription({
        descriptionHtml: '<p>Full</p>',
        descriptionText: 'Full',
        description: 'legacy',
      }),
    ).toBe('<p>Full</p>');
  });

  it('merges OE numbers from RealTrack fields and title', () => {
    const nums = extractListingOeNumbers(
      {
        oeNumbers: ['ABC123'],
        mpn: 'MPN999',
        itemSpecifics: { 'Manufacturer Part Number': 'OEM111' },
      },
      ['TITLE222'],
    );
    expect(nums).toEqual(['ABC123', 'MPN999', 'OEM111', 'TITLE222']);
  });

  it('reads brand from listing or specifics', () => {
    expect(extractListingBrand({ brand: 'Audi' })).toBe('Audi');
    expect(extractListingBrand({ itemSpecifics: { Brand: 'BMW' } })).toBe('BMW');
  });
});
