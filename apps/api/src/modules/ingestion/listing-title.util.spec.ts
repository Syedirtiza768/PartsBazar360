/**
 * Unit tests for English title extraction.
 */
import {
  extractEnglishTitle,
  looksLikeEnglishTitle,
} from './listing-title.util';

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
    expect(
      looksLikeEnglishTitle('Used Steering Column for Porsche Cayenne 2008'),
    ).toBe(true);
    expect(looksLikeEnglishTitle('エンジン トヨタ')).toBe(false);
  });

  it('rejects Italian, French, German and Spanish titles', () => {
    expect(
      looksLikeEnglishTitle('Centralina clima BMW 330e 2016-2020 16046610'),
    ).toBe(false);
    expect(looksLikeEnglishTitle('Cache volant BMW 335i 2009 occasion')).toBe(
      false,
    );
    expect(
      looksLikeEnglishTitle('Braccio Comando Sospensioni Inferiore VW Jetta'),
    ).toBe(false);
    expect(looksLikeEnglishTitle('Stoßstange vorne Audi A4 gebraucht')).toBe(
      false,
    );
    expect(looksLikeEnglishTitle('Amortiguador delantero Seat Leon')).toBe(
      false,
    );
  });

  it('matches accented terms that ASCII word boundaries would miss', () => {
    expect(looksLikeEnglishTitle('Tür hinten links Golf V')).toBe(false);
    expect(looksLikeEnglishTitle('Ölpumpe BMW E46')).toBe(false);
  });

  it('keeps English titles that contain lookalike words', () => {
    expect(looksLikeEnglishTitle('Flexible Brake Hose Front Toyota')).toBe(
      true,
    );
    expect(
      looksLikeEnglishTitle('2018 Ford F-150 Air Filter Housing Used OEM'),
    ).toBe(true);
    expect(looksLikeEnglishTitle('Rear Suspension Control Arm Bushing')).toBe(
      true,
    );
  });

  it('rejects blank titles', () => {
    expect(looksLikeEnglishTitle('')).toBe(false);
  });
});
