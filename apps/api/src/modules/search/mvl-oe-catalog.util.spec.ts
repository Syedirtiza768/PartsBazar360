import {
  dedupeCatalogRows,
  extractChassisPlatform,
  partHasOeNumber,
  shouldExpandOeCatalog,
  summarizeCompatibleVehicles,
  type MvlCatalogRow,
} from './mvl-oe-catalog.util';

describe('extractChassisPlatform', () => {
  it('reads exact DE partsModel codes', () => {
    expect(extractChassisPlatform('X260', null, 'XF')).toBe('X260');
    expect(extractChassisPlatform('X250', 'X250', 'XF')).toBe('X250');
  });

  it('extracts chassis codes from UK region strings', () => {
    expect(extractChassisPlatform(null, 'RWD II X260', 'XF')).toBe('X260');
    expect(extractChassisPlatform(null, 'AWD I X250', 'XF')).toBe('X250');
    expect(extractChassisPlatform(null, 'AWD -- X260', 'XF')).toBe('X260');
  });

  it('ignores model-name-only US partsModel', () => {
    expect(extractChassisPlatform('XF', null, 'XF')).toBeNull();
  });
});

describe('partHasOeNumber', () => {
  it('detects oeNumbers and genuine OEM fields', () => {
    expect(partHasOeNumber({ oeNumbers: ['T2H4903'] })).toBe(true);
    expect(partHasOeNumber({ genuineOemPartNumber: 'T2H4903' })).toBe(true);
    expect(
      partHasOeNumber({
        partSource: 'OEM',
        manufacturerPartNumber: 'T2H4903',
      }),
    ).toBe(true);
    expect(partHasOeNumber({ oeNumbers: [], partSource: 'AFTERMARKET' })).toBe(
      false,
    );
  });
});

describe('shouldExpandOeCatalog', () => {
  it('expands empty or donor-only tables', () => {
    expect(shouldExpandOeCatalog([])).toBe(true);
    expect(
      shouldExpandOeCatalog([
        { year: 2017, make: 'Jaguar', model: 'XF' },
      ]),
    ).toBe(true);
  });

  it('skips already-rich multi-year tables', () => {
    expect(
      shouldExpandOeCatalog([
        { year: 2016, make: 'Jaguar', model: 'XF' },
        { year: 2017, make: 'Jaguar', model: 'XF' },
        { year: 2018, make: 'Jaguar', model: 'XF' },
        { year: 2019, make: 'Jaguar', model: 'XF' },
      ]),
    ).toBe(false);
  });
});

describe('summarizeCompatibleVehicles', () => {
  it('collapses trim rows into year-range chips', () => {
    const rows: MvlCatalogRow[] = [
      {
        year: 2016,
        make: 'Jaguar',
        model: 'XF',
        trim: 'Prestige',
        engine: '3.0',
        source: 'mvl_catalog',
        mvlVerified: true,
      },
      {
        year: 2020,
        make: 'Jaguar',
        model: 'XF',
        trim: 'S',
        engine: '2.0',
        source: 'mvl_catalog',
        mvlVerified: true,
      },
    ];
    const chips = summarizeCompatibleVehicles(rows);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('2016-2020 Jaguar XF');
    expect(chips[0].evidenceLevel).toBe('B');
  });
});

describe('dedupeCatalogRows', () => {
  it('dedupes identical year/trim/engine rows', () => {
    const row: MvlCatalogRow = {
      year: 2017,
      make: 'Jaguar',
      model: 'XF',
      trim: '2.0 D',
      engine: '1999 ccm',
      source: 'mvl_catalog',
      mvlVerified: true,
    };
    expect(dedupeCatalogRows([row, { ...row }])).toHaveLength(1);
  });
});
