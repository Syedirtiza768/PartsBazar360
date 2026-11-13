import { BadRequestException } from '@nestjs/common';
import { parseOptionalWeightKg } from './support.service';

describe('parseOptionalWeightKg', () => {
  it('treats missing and blank form values as no weight', () => {
    expect(parseOptionalWeightKg(undefined)).toBeNull();
    expect(parseOptionalWeightKg(null)).toBeNull();
    expect(parseOptionalWeightKg('')).toBeNull();
    expect(parseOptionalWeightKg('   ')).toBeNull();
  });

  it('accepts numbers and numeric strings', () => {
    expect(parseOptionalWeightKg(12.5)).toBe(12.5);
    expect(parseOptionalWeightKg('12.5')).toBe(12.5);
    expect(parseOptionalWeightKg(' 8 ')).toBe(8);
  });

  it('rejects non-numeric and non-positive weights with a 400', () => {
    for (const bad of ['abc', '0', -3, Number.NaN]) {
      expect(() => parseOptionalWeightKg(bad)).toThrow(BadRequestException);
    }
  });
});
