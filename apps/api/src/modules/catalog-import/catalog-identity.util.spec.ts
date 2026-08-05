import {
  canonicalizeCatalogBrand,
  canonicalizeVehicleMake,
  canonicalizeVehicleMakes,
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
    ['MEYLE-1006100011', 'MEYLE'],
    ['MEYLE-4149031111', 'MEYLE'],
    ['REMSA-0653.00', 'REMSA'],
    ['REMSA-0654.00', 'REMSA'],
    ['REMSA-0773.20', 'REMSA'],
    ['REMSA-1066.00', 'REMSA'],
    ['REMSA-1066.30', 'REMSA'],
    ['REMSA-1366.00', 'REMSA'],
    ['REMSA-1379.00', 'REMSA'],
  ])('normalizes brand %s to %s', (raw, expected) => {
    expect(canonicalizeCatalogBrand(raw)).toBe(expected);
  });

  it('normalizes any brand-code style value to a shared brand bucket', () => {
    expect(canonicalizeCatalogBrand('ATE-13.0460-7117.2')).toBe('ATE');
    expect(canonicalizeCatalogBrand('Blue Print-ADH24273')).toBe('BLUE PRINT');
    expect(canonicalizeCatalogBrand('SKF:VKBA 3644')).toBe('SKF');
  });

  it('splits combined vehicle makes into separate canonical makes', () => {
    expect(canonicalizeVehicleMakes('PEUGEOT/CITROEN')).toEqual([
      'Peugeot',
      'Citroen',
    ]);
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
