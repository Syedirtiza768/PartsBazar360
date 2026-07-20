import {
  prioritizeEbayImages,
  isEbayImageUrl,
  extractListingImages,
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
});
