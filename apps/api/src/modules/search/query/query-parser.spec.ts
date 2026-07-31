import {
  normalizePartNumber,
  partNumberVariants,
  looksLikePartNumber,
  partNumberConfidence,
  extractPartNumberCandidates,
} from './part-number.util';
import { parseQuery, isPartNumberQuery } from './query-parser';

describe('normalizePartNumber', () => {
  it('treats every separator form of an OEM number as equivalent (brief §4)', () => {
    const forms = ['8640112020', '86401-12020', '86401 12020', '86401/12020', '86401.12020'];
    const normalized = forms.map(normalizePartNumber);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('8640112020');
  });

  it('is case- and unicode-insensitive', () => {
    expect(normalizePartNumber('a2218200264')).toBe('A2218200264');
    expect(normalizePartNumber('Ａ２２１')).toBe('A221');
  });

  it('handles null and undefined without throwing', () => {
    expect(normalizePartNumber(null)).toBe('');
    expect(normalizePartNumber(undefined)).toBe('');
  });
});

describe('partNumberVariants', () => {
  it('strips seller prefixes as an additional variant, not a replacement', () => {
    const variants = partNumberVariants('OEM8640112020');
    expect(variants[0]).toBe('OEM8640112020');
    expect(variants).toContain('8640112020');
  });

  it('offers a leading-zero-stripped variant', () => {
    expect(partNumberVariants('0012345')).toContain('12345');
  });

  it('does not invent variants for a clean number', () => {
    expect(partNumberVariants('8640112020')).toEqual(['8640112020']);
  });
});

describe('looksLikePartNumber', () => {
  it.each(['8640112020', '86401-12020', 'A2218200264', '0125-141', '06E100035'])(
    'accepts %s',
    (token) => expect(looksLikePartNumber(token)).toBe(true),
  );

  it.each(['2019', '1998', 'headlight', 'front', '4', 'the', ''])(
    'rejects %s',
    (token) => expect(looksLikePartNumber(token)).toBe(false),
  );
});

describe('partNumberConfidence', () => {
  it('trusts a long unseparated number fully', () => {
    expect(partNumberConfidence('8640112020')).toBe(1);
  });

  it('discounts heavily-separated and short numbers (collision risk, brief §4)', () => {
    expect(partNumberConfidence('A 221 820 02 64')).toBeLessThan(1);
    expect(partNumberConfidence('12-34')).toBeLessThan(
      partNumberConfidence('8640112020'),
    );
  });

  it('never returns zero for a real number', () => {
    expect(partNumberConfidence('1-2-3-4-5-6-7-8')).toBeGreaterThanOrEqual(0.3);
  });
});

describe('extractPartNumberCandidates', () => {
  it('joins manufacturer-formatted multi-group numbers', () => {
    // The production defect: this query returned 3,742 unrelated results.
    expect(extractPartNumberCandidates('A 221 820 02 64')).toContain('A2218200264');
  });

  it('joins a split OEM number', () => {
    expect(extractPartNumberCandidates('86401 12020')).toContain('8640112020');
  });

  it('lets a joined number subsume the groups that built it', () => {
    // "86401 12020" means one number, not two. Without this the spaced form
    // probes three numbers while "86401-12020" probes one, and the two forms
    // return different results — the brief §4 equivalence requirement.
    expect(extractPartNumberCandidates('86401 12020')).toEqual(['8640112020']);
    expect(extractPartNumberCandidates('86401 12020')).toEqual(
      extractPartNumberCandidates('86401-12020'),
    );
  });

  it('finds a part number embedded in a descriptive query', () => {
    const found = extractPartNumberCandidates(
      '2019 Toyota Corolla front center lane camera 8640112020',
    );
    expect(found).toContain('8640112020');
  });

  it('does not treat ordinary prose as a part number', () => {
    expect(extractPartNumberCandidates('front left door handle')).toEqual([]);
    expect(extractPartNumberCandidates('rear left tail light Audi TT')).toEqual([]);
  });

  it('does not treat a bare year as a part number', () => {
    expect(extractPartNumberCandidates('2019 corolla camera')).toEqual([]);
  });
});

describe('parseQuery — vehicle extraction', () => {
  it('parses the brief\'s worked example (§6)', () => {
    const parsed = parseQuery('2019 Toyota Corolla front center lane camera 8640112020');
    expect(parsed.year).toBe(2019);
    expect(parsed.make).toBe('Toyota');
    expect(parsed.model).toBe('Corolla');
    expect(parsed.positions).toEqual(expect.arrayContaining(['FRONT', 'CENTER']));
    expect(parsed.partNumbers).toContain('8640112020');
    expect(parsed.synonymGroups).toContain('lane camera');
  });

  it('parses "2013 BMW 520i shifter"', () => {
    const parsed = parseQuery('2013 BMW 520i shifter');
    expect(parsed.year).toBe(2013);
    expect(parsed.make).toBe('BMW');
    expect(parsed.synonymGroups).toContain('gear selector');
  });

  it('resolves a chassis code to its make ("BMW F10 gear selector")', () => {
    const parsed = parseQuery('BMW F10 gear selector');
    expect(parsed.make).toBe('BMW');
    expect(parsed.chassis).toBe('F10');
    expect(parsed.synonymGroups).toContain('gear selector');
  });

  it('infers the make from a chassis code alone ("W221 blower")', () => {
    const parsed = parseQuery('W221 blower');
    expect(parsed.make).toBe('Mercedes-Benz');
    expect(parsed.chassis).toBe('W221');
  });

  it('parses engine displacement ("Audi A6 2.8 engine")', () => {
    const parsed = parseQuery('Audi A6 2.8 engine');
    expect(parsed.make).toBe('Audi');
    expect(parsed.model).toBe('A6');
    expect(parsed.engineLitres).toBe(2.8);
  });

  it('parses a year range', () => {
    const parsed = parseQuery('2015-2018 Ford Focus headlight');
    expect(parsed.yearRange).toEqual({ from: 2015, to: 2018 });
    expect(parsed.year).toBeUndefined();
    expect(parsed.make).toBe('Ford');
  });

  it('prefers the multi-word make over a substring ("Land Rover")', () => {
    expect(parseQuery('Land Rover Defender door').make).toBe('Land Rover');
  });

  it('maps make aliases', () => {
    expect(parseQuery('vw golf bumper').make).toBe('Volkswagen');
    expect(parseQuery('chevy silverado mirror').make).toBe('Chevrolet');
    expect(parseQuery('merc c-class grille').make).toBe('Mercedes-Benz');
  });

  it('does not resolve a model belonging to a different detected make', () => {
    // "civic" is a Honda model; the make is explicitly Toyota.
    expect(parseQuery('toyota civic').model).toBeUndefined();
  });

  it('leaves an unknown token in freeText rather than guessing', () => {
    const parsed = parseQuery('zephyr flux capacitor');
    expect(parsed.make).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.freeText).toContain('zephyr');
  });
});

describe('parseQuery — side, position, condition', () => {
  it('parses "LH headlight" (production returned 2,807 unrelated results)', () => {
    const parsed = parseQuery('LH headlight');
    expect(parsed.side).toBe('LEFT');
    expect(parsed.synonymGroups).toContain('headlight');
  });

  it('treats driver side as left and passenger side as right', () => {
    expect(parseQuery('driver side mirror').side).toBe('LEFT');
    expect(parseQuery('passenger side mirror').side).toBe('RIGHT');
  });

  it('parses "rear left tail light Audi TT"', () => {
    const parsed = parseQuery('rear left tail light Audi TT');
    expect(parsed.side).toBe('LEFT');
    expect(parsed.positions).toContain('REAR');
    expect(parsed.make).toBe('Audi');
    expect(parsed.synonymGroups).toContain('tail light');
  });

  it('parses condition', () => {
    expect(parseQuery('used alternator').condition).toBe('USED');
    expect(parseQuery('remanufactured starter').condition).toBe('REMANUFACTURED');
    expect(parseQuery('refurb abs module').condition).toBe('REFURBISHED');
  });
});

describe('parseQuery — synonym expansion (brief §7)', () => {
  it('unifies "tail light" and "taillight" (production: 983 vs 22 results)', () => {
    const spaced = parseQuery('tail light');
    const joined = parseQuery('taillight');
    expect(spaced.synonymGroups).toEqual(joined.synonymGroups);
    expect(new Set(spaced.expandedTerms)).toEqual(new Set(joined.expandedTerms));
  });

  it('expands headlight to headlamp', () => {
    expect(parseQuery('headlight').expandedTerms).toContain('headlamp');
  });

  it('expands ECU to its equivalents', () => {
    const terms = parseQuery('ecu').expandedTerms;
    expect(terms).toEqual(expect.arrayContaining(['ecm', 'engine control module']));
  });

  it('does not expand a term with no synonym group', () => {
    expect(parseQuery('grommet').synonymGroups).toEqual([]);
  });
});

describe('isPartNumberQuery', () => {
  it('is true for a bare part number', () => {
    expect(isPartNumberQuery(parseQuery('8640112020'))).toBe(true);
    expect(isPartNumberQuery(parseQuery('86401-12020'))).toBe(true);
  });

  it('is false when the query also describes a part', () => {
    expect(isPartNumberQuery(parseQuery('corolla camera 8640112020'))).toBe(false);
  });

  it('is false for a purely descriptive query', () => {
    expect(isPartNumberQuery(parseQuery('front bumper'))).toBe(false);
  });
});

describe('parseQuery — regressions found by inspecting parser output', () => {
  it('does not join a year to a make ("2019 Toyota" ≠ part number 2019TOYOTA)', () => {
    const parsed = parseQuery('2019 Toyota Corolla lane camera');
    expect(parsed.partNumbers).toEqual([]);
    expect(parsed.year).toBe(2019);
    expect(parsed.make).toBe('Toyota');
  });

  it('does not treat a chassis code as a part number', () => {
    const parsed = parseQuery('W221 blower');
    expect(parsed.partNumbers).toEqual([]);
    expect(parsed.chassis).toBe('W221');
  });

  it('does not treat a year range as a part number', () => {
    expect(looksLikePartNumber('2015-2018')).toBe(false);
    expect(parseQuery('2015-2018 Ford Focus').partNumbers).toEqual([]);
  });

  it('removes every token a part number consumed from freeText', () => {
    // Otherwise "221", "820" etc. also match as descriptive words — the
    // production defect that returned 3,742 results for this query.
    expect(parseQuery('A 221 820 02 64').freeText).toBe('');
    expect(parseQuery('86401-12020').freeText).toBe('');
  });

  it('strips an explicit make even when a chassis code already implied it', () => {
    expect(parseQuery('BMW F10 gear selector').freeText).toBe('gear selector');
  });

  it('gives models manufacturer-correct display casing', () => {
    expect(parseQuery('audi a6').model).toBe('A6');
    expect(parseQuery('toyota corolla').model).toBe('Corolla');
    expect(parseQuery('ford f-150 mirror').model).toBe('F-150');
    expect(parseQuery('jeep grand cherokee door').model).toBe('Grand Cherokee');
  });
});

describe('parseQuery — robustness', () => {
  it('handles empty and whitespace input', () => {
    expect(parseQuery('').normalized).toBe('');
    expect(parseQuery('   ').partNumbers).toEqual([]);
  });

  it('is stable across repeated calls', () => {
    const a = parseQuery('2019 Toyota Corolla lane camera');
    const b = parseQuery('2019 Toyota Corolla lane camera');
    expect(a).toEqual(b);
  });

  it('does not throw on adversarial input', () => {
    expect(() => parseQuery('*'.repeat(500))).not.toThrow();
    expect(() => parseQuery('((((')).not.toThrow();
    expect(() => parseQuery('a'.repeat(5000))).not.toThrow();
  });
});
