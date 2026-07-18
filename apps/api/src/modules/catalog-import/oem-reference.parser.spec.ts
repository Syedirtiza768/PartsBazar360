import { parseCompoundOemReferences } from './oem-reference.parser';
import { classifyPart } from './classification.util';
import { normalizePartNumber } from './part-normalization.util';

describe('catalog import normalization', () => {
  it('normalizes punctuation and spacing without changing display values', () => {
    expect(normalizePartNumber('43202-1KA0A')).toBe('432021KA0A');
    expect(normalizePartNumber('43202 1KA0A')).toBe('432021KA0A');
  });

  it('uses longest-match parsing for multi-word makes', () => {
    const parsed = parseCompoundOemReferences('FORD 1 439 867, LAND ROVER LR 003655');
    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalMake: 'Ford', displayNumber: '1 439 867', normalizedNumber: '1439867' }),
      expect.objectContaining({ canonicalMake: 'Land Rover', displayNumber: 'LR 003655', normalizedNumber: 'LR003655' }),
    ]));
  });

  it('keeps the same visible number separate by issuer', () => {
    const parsed = parseCompoundOemReferences('CHRYSLER MB581311, MITSUBISHI MB581311');
    expect(parsed).toHaveLength(2);
    expect(new Set(parsed.map((row) => row.canonicalMake))).toEqual(new Set(['Chrysler', 'Mitsubishi']));
  });

  it('never treats a vehicle-looking brand as sufficient genuine evidence', () => {
    expect(classifyPart({ brand: 'BMW', sourceContext: 'MIXED_CATALOG' })).toMatchObject({
      partType: 'UNCLASSIFIED',
      status: 'ACTION_REQUIRED',
    });
  });

  it('classifies the FEBEST catalog as aftermarket with high confidence', () => {
    expect(classifyPart({ brand: 'FEBEST', sourceContext: 'AFTERMARKET_CATALOG' })).toMatchObject({
      partType: 'AFTERMARKET',
      status: 'READY',
    });
  });
});
