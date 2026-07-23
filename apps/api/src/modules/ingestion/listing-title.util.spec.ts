/**
 * Unit tests for English title extraction.
 */
import { extractEnglishTitle, looksLikeEnglishTitle } from './listing-title.util';

describe('listing-title.util', () => {
  it('prefers titleEn over title', () => {
    expect(
      extractEnglishTitle({ title: 'Titulo ES', titleEn: 'English Title' }),
    ).toBe('English Title');
  });

  it('falls back to title', () => {
    expect(extractEnglishTitle({ title: 'Used Steering Column' })).toBe(
      'Used Steering Column',
    );
  });

  it('detects English titles', () => {
    expect(looksLikeEnglishTitle('Used Steering Column for Porsche Cayenne 2008')).toBe(true);
    expect(looksLikeEnglishTitle('エンジン トヨタ')).toBe(false);
  });
});
