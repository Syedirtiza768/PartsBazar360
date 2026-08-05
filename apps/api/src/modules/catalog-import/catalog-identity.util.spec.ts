import {
  canonicalizeCatalogBrand,
  canonicalizeVehicleMake,
  expandCatalogBrandFilterValues,
} from './catalog-identity.util';

describe('catalog identity normalization', () => {
  it.each([
    ['Mercedes', 'Mercedes-Benz'],
    ['MERCEDES BENZ', 'Mercedes-Benz'],
    ['Mercedes‑Benz', 'Mercedes-Benz'],
    ['VolksWagen', 'Volkswagen'],
    ['Volkwagen', 'Volkswagen'],
    ['V.W', 'Volkswagen'],
    ['Range Rover', 'Land Rover'],
    ['CADILAC', 'Cadillac'],
    ['INFITY', 'Infiniti'],
    ['PORCSHE', 'Porsche'],
  ])('normalizes make %s to %s', (raw, expected) => {
    expect(canonicalizeVehicleMake(raw)).toBe(expected);
  });

  it.each([
    ['Toyota Corolla', 'Toyota'],
    ['Audi A4', 'Audi'],
    ['MINI COUNTRYMAN', 'Mini'],
    ['TRUCK TEC', 'TRUCKTEC'],
    ['SCHEINDER', 'SCHNIEDER'],
    ['BOSH-0242240566', 'BOSCH'],
    ['MANN FILTER', 'MANN-FILTER'],
  ])('normalizes brand %s to %s', (raw, expected) => {
    expect(canonicalizeCatalogBrand(raw)).toBe(expected);
  });

  it('removes placeholder values that are not brands', () => {
    expect(canonicalizeCatalogBrand('Genuine OEM')).toBeNull();
    expect(canonicalizeCatalogBrand('ORIGINAL')).toBeNull();
    expect(canonicalizeCatalogBrand('Unknown')).toBeNull();
  });

  it('expands a canonical filter to legacy indexed aliases', () => {
    const values = expandCatalogBrandFilterValues(['Volkswagen']);
    expect(values).toEqual(expect.arrayContaining(['Volkswagen', 'VW', 'volkwagen']));
  });
});
