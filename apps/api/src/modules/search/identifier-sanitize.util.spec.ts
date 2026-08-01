/**
 * Unit checks for the identifier-field guard. The regressions named here are
 * the real documents that ranked 1-5 for "Audi bumper" in production.
 */
import {
  isIndexableIdentifier,
  sanitizeIdentifier,
  sanitizeIdentifierList,
} from './identifier-sanitize.util';

describe('identifier-sanitize', () => {
  it('rejects the part-name words that polluted the boosted fields', () => {
    // These are the exact values that put a Porsche vent grille and an Audi
    // stone guard above every real Audi bumper.
    expect(isIndexableIdentifier('BUMPER')).toBe(false);
    expect(isIndexableIdentifier('AUDI')).toBe(false);
    expect(isIndexableIdentifier('Unknown')).toBe(false);
    expect(isIndexableIdentifier('N/A')).toBe(false);
    expect(isIndexableIdentifier('-')).toBe(false);
    expect(isIndexableIdentifier('')).toBe(false);
  });

  it('keeps real part numbers in every format the feeds emit', () => {
    expect(isIndexableIdentifier('8R0807453C')).toBe(true);
    expect(isIndexableIdentifier('5C5853665D/9B9')).toBe(true);
    expect(isIndexableIdentifier('955-505-682-10-9B9')).toBe(true);
    expect(isIndexableIdentifier('3BO 807 217 A')).toBe(true);
    expect(isIndexableIdentifier('51118226557')).toBe(true);
  });

  it('rejects non-strings rather than coercing them', () => {
    expect(isIndexableIdentifier(null)).toBe(false);
    expect(isIndexableIdentifier(undefined)).toBe(false);
    expect(isIndexableIdentifier(12345)).toBe(false);
  });

  it('trims survivors and nulls out descriptions', () => {
    expect(sanitizeIdentifier('  8R0807453C  ')).toBe('8R0807453C');
    expect(sanitizeIdentifier('BUMPER')).toBeNull();
  });

  it('filters and de-duplicates identifier arrays', () => {
    // The BMW E39 cover really did index as ["BUMPER", "5C5853665D"].
    expect(sanitizeIdentifierList(['BUMPER', '5C5853665D'])).toEqual([
      '5C5853665D',
    ]);
    expect(sanitizeIdentifierList(['4E0807105R', ' 4E0807105R '])).toEqual([
      '4E0807105R',
    ]);
    expect(sanitizeIdentifierList(null)).toEqual([]);
    expect(sanitizeIdentifierList(['BUMPER', 'AUDI'])).toEqual([]);
  });

  it('keeps comma-joined elements whole (splitting belongs in ingest)', () => {
    expect(
      sanitizeIdentifierList(['955-505-682-10-9B9, 955 505 682 109 B9']),
    ).toEqual(['955-505-682-10-9B9, 955 505 682 109 B9']);
  });
});
