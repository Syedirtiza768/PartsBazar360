import {
  filterDeadCatalogImagePaths,
  isDeadCatalogImagePath,
} from './image-url.util';

describe('catalog image URL safety', () => {
  it('recognizes the legacy paths whose route is not deployed', () => {
    expect(
      isDeadCatalogImagePath('/api/search/parts/part-123/catalog-image/0.jpg'),
    ).toBe(true);
    expect(isDeadCatalogImagePath('https://cdn.example.com/part.jpg')).toBe(
      false,
    );
  });

  it('keeps valid media while removing dead imported paths', () => {
    expect(
      filterDeadCatalogImagePaths([
        { url: '/api/search/parts/part-123/catalog-image/0.jpg' },
        { url: 'https://cdn.example.com/part.jpg' },
      ]),
    ).toEqual([{ url: 'https://cdn.example.com/part.jpg' }]);
  });
});
