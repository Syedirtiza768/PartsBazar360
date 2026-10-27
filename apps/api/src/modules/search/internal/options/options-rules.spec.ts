import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ITEM_SPECIFIC_NUMBER_KEYS,
  classifyDirect,
  distinctNumbers,
  editDistance,
  expansionNumbers,
  isSignificantNumber,
  itemSpecificGenuine,
  itemSpecificNumbers,
  numbersOfPart,
  splitNumberList,
  strongestRef,
  type NumberedPart,
} from './number-graph';
import {
  decideVerdict,
  evidenceStrength,
  parseEngineLitres,
  summarizeDocumented,
  type ResolvedVehicle,
} from './fitment-verdict';
import { summarizeAvailability } from './availability';
import type { InternalOffer } from '../internal-search.service';

const part = (overrides: Partial<NumberedPart> = {}): NumberedPart => ({
  id: 'p',
  brand: 'Toyota',
  partSource: 'OEM',
  manufacturerPartNumber: '86401-12020',
  oeNumbers: [],
  catalogNumbers: [],
  ...overrides,
});

describe('number graph', () => {
  it('splits comma-joined stored lists and normalizes every value', () => {
    expect(splitNumberList('XR816247, 1R8E9K461CD')).toEqual([
      'XR816247',
      '1R8E9K461CD',
    ]);
    const refs = numbersOfPart(
      part({ oeNumbers: ['63-31-9-263-453', 'XR816247, 1R8E9K461CD'] }),
    );
    expect(refs.map((r) => r.number)).toEqual([
      '8640112020',
      '63319263453',
      'XR816247',
      '1R8E9K461CD',
    ]);
  });

  it('only treats ≥5-char numbers with a digit as significant', () => {
    expect(isSignificantNumber('12345')).toBe(true);
    expect(isSignificantNumber('1234')).toBe(false);
    expect(isSignificantNumber('ABCDEF')).toBe(false);
    expect(isSignificantNumber('00000')).toBe(false);
  });

  it('classifies the part itself as exact, whatever the separator', () => {
    for (const q of ['8640112020']) {
      expect(classifyDirect(part(), new Set([q]))?.relation).toBe('exact');
    }
  });

  it('OEM part listing the number among OE numbers is an OEM equivalent', () => {
    const oem = part({
      manufacturerPartNumber: '86401-12030',
      oeNumbers: ['86401-12020'],
    });
    expect(classifyDirect(oem, new Set(['8640112020']))?.relation).toBe(
      'oem_equivalent',
    );
  });

  it('aftermarket part declaring it replaces the number is an aftermarket equivalent', () => {
    const febest = part({
      brand: 'Febest',
      partSource: 'AFTERMARKET',
      manufacturerPartNumber: '0128-ZZT240',
      oeNumbers: ['8640112020'],
    });
    const match = classifyDirect(febest, new Set(['8640112020']));
    expect(match?.relation).toBe('aftermarket_equivalent');
    expect(match?.matched.display).toBe('8640112020');
  });

  it('superseded catalogue rows classify as superseded', () => {
    const p = part({
      manufacturerPartNumber: '86401-12030',
      catalogNumbers: [
        {
          displayNumber: '86401-12020',
          normalizedNumber: '8640112020',
          numberType: 'SUPERSEDED',
          source: 'TOYOTA_EPC',
          verificationStatus: 'VERIFIED',
          confidence: 1,
        },
      ],
    });
    expect(classifyDirect(p, new Set(['8640112020']))?.relation).toBe(
      'superseded',
    );
  });

  it('seller SKUs are never used for equivalence', () => {
    const p = part({
      catalogNumbers: [
        {
          displayNumber: 'SKU-12345',
          normalizedNumber: 'SKU12345',
          numberType: 'SELLER_SKU',
          source: 'x',
          verificationStatus: 'UNVERIFIED',
          confidence: 1,
        },
      ],
    });
    expect(numbersOfPart(p).some((r) => r.number === 'SKU12345')).toBe(false);
  });

  it('expands through other significant numbers only', () => {
    const p = part({ oeNumbers: ['8640112021', '123'] });
    expect(
      expansionNumbers(p, new Set(['8640112020'])).map((r) => r.number),
    ).toEqual(['8640112021']);
  });

  it('reads role-tagged numbers from listing item specifics (all languages, lists and arrays)', () => {
    const specifics = {
      supersededPartNumber: '03H103173D, 066103173G',
      interchangePartNumber: '06E127065G',
      'oE/OEMTeilenummer': '5560730220',
      OE_numbers: ['4782718AA'],
      partOutID: 'A-130763493',
      referenceNumber: '5',
      vINNumber: 'WVWZZZ1JZXW000001',
    };
    const found = itemSpecificNumbers(specifics);
    expect(found.map((s) => [s.key, s.role])).toEqual([
      ['OE_numbers', 'OE'],
      ['oE/OEMTeilenummer', 'OE'],
      ['interchangePartNumber', 'INTERCHANGE'],
      ['supersededPartNumber', 'SUPERSEDED'],
    ]);
    const refs = numbersOfPart(part({ specificNumbers: found }));
    expect(refs.find((r) => r.number === '066103173G')).toMatchObject({
      role: 'SUPERSEDED',
      verified: false,
    });
    expect(itemSpecificNumbers(null)).toEqual([]);
    expect(itemSpecificNumbers(['x'])).toEqual([]);
  });

  it('a superseded number copied into oeNumbers still classifies as superseded', () => {
    // Importers copy item specifics into oeNumbers, which loses the role.
    const p = part({
      manufacturerPartNumber: '066103173J',
      oeNumbers: ['03H103173D, 066103173G'],
      specificNumbers: [
        { key: 'supersededPartNumber', role: 'SUPERSEDED', value: '03H103173D, 066103173G' },
      ],
    });
    expect(classifyDirect(p, new Set(['066103173G']))?.relation).toBe('superseded');
    const refs = numbersOfPart(p);
    expect(strongestRef(refs, new Set(['066103173G']))?.role).toBe('SUPERSEDED');
    expect(distinctNumbers(refs).map((r) => [r.number, r.role])).toEqual([
      ['066103173J', 'MPN'],
      ['03H103173D', 'SUPERSEDED'],
      ['066103173G', 'SUPERSEDED'],
    ]);
  });

  it('a "Genuine OEM: Yes" listing makes an aftermarket-branded part an OEM equivalent', () => {
    expect(itemSpecificGenuine({ genuineOEM: 'Yes' })).toBe(true);
    expect(itemSpecificGenuine({ oEM: 'Ja' })).toBe(true);
    expect(itemSpecificGenuine({ genuineOEM: 'No' })).toBe(false);
    const p = part({
      brand: 'Volkswagen',
      partSource: 'USED',
      manufacturerPartNumber: '5Q0907511L',
      oeNumbers: ['5Q0907511A'],
      genuineFlag: true,
    });
    expect(classifyDirect(p, new Set(['5Q0907511A']))?.relation).toBe('oem_equivalent');
  });

  it('splits one-per-line lists too', () => {
    expect(splitNumberList('A1646201761\nA1646200761')).toEqual(['A1646201761', 'A1646200761']);
  });

  it('the SQL lookup function covers exactly the item-specific keys the graph reads', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../../prisma/migrations/20261027120000_part_numbers_lookup/migration.sql'),
      'utf8',
    );
    const arrays = [...sql.matchAll(/ARRAY\[([\s\S]*?)\]/g)].map((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1]).sort(),
    );
    const keys = Object.keys(ITEM_SPECIFIC_NUMBER_KEYS).sort();
    expect(arrays).toHaveLength(2);
    for (const list of arrays) expect(list).toEqual(keys);
  });

  it('bounded edit distance', () => {
    expect(editDistance('8640112020', '8640112030')).toBe(1);
    expect(editDistance('8640112020', 'ABCDEFGHIJ', 2)).toBe(3);
  });
});

const vehicle = (
  overrides: Partial<ResolvedVehicle> = {},
): ResolvedVehicle => ({
  label: '2018 Audi Q5',
  make: 'Audi',
  model: 'Q5',
  year: 2018,
  configIds: ['c20', 'c30', 'cglobal'],
  configLitres: { c20: 2.0, c30: 3.0, cglobal: null },
  ...overrides,
});

const strong = (configId: string) => ({
  vehicleConfigId: configId,
  evidenceType: 'FEBEST_WEBSITE',
  evidenceLevel: 'B',
  source: 'https://febest.de/x',
  verificationStatus: 'VERIFIED',
});
const titleOnly = (configId: string) => ({
  vehicleConfigId: configId,
  evidenceType: 'TITLE_MVL',
  evidenceLevel: 'B',
  source: 'TITLE_MVL',
  verificationStatus: 'VERIFIED',
});
const base = {
  compatibilityListsVehicle: false,
  documented: null,
  hasAnyFitment: true,
  title: 'Control arm',
  position: null,
};

describe('fitment verdicts', () => {
  it('grades by evidence kind, not just the letter', () => {
    expect(evidenceStrength(strong('c'))).toBe('strong');
    expect(evidenceStrength(titleOnly('c'))).toBe('medium');
    expect(
      evidenceStrength({
        evidenceType: 'TITLE_PARSE',
        evidenceLevel: 'B',
        source: 'LEMFORDER_FCPEURO_MVL',
        verificationStatus: 'VERIFIED',
      }),
    ).toBe('strong');
    expect(
      evidenceStrength({
        evidenceType: 'FEBEST_WEBSITE',
        evidenceLevel: 'C',
        source: null,
        verificationStatus: 'VERIFIED',
      }),
    ).toBe('medium');
  });

  it('parses engine litres from the messy config strings', () => {
    expect(parseEngineLitres('1968 ccm, 100 KW, 136 PS')).toBe(2.0);
    expect(
      parseEngineLitres('2.0L 1984CC 121Cu. In. l4 GAS DOHC Turbocharged'),
    ).toBe(2.0);
    expect(parseEngineLitres('2.0 TFSI quattro')).toBe(2.0);
    expect(parseEngineLitres('2995cc')).toBe(3.0);
    expect(parseEngineLitres('')).toBeNull();
  });

  it('fits when strong evidence matches the selected engine', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle({ engineLitres: 2.0 }),
      evidence: [strong('c20')],
    });
    expect(r?.verdict).toBe('fits');
  });

  it('does not claim fit for another engine — and does not claim non-fit either', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle({ engineLitres: 3.0 }),
      evidence: [strong('c20')],
    });
    expect(r?.verdict).toBe('unverified');
    expect(r?.reason).toMatch(/2\.0 L only/);
  });

  it('is only "likely" when the engine is unknown and not every engine is documented', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle(),
      evidence: [strong('c20')],
    });
    expect(r?.verdict).toBe('likely');
  });

  it('fits without an engine when every engine of the model year is documented', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle(),
      evidence: [strong('c20'), strong('c30')],
    });
    expect(r?.verdict).toBe('fits');
  });

  it('fits the exact configuration the user picked', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle({ exactConfigId: 'c30' }),
      evidence: [strong('c30')],
    });
    expect(r?.verdict).toBe('fits');
  });

  it('title-derived evidence is at most "likely"', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle({ engineLitres: 2.0 }),
      evidence: [titleOnly('c20')],
    });
    expect(r?.verdict).toBe('likely');
  });

  it('a missing fitment row is unverified, never "does not fit"', () => {
    const r = decideVerdict({
      ...base,
      vehicle: vehicle(),
      evidence: [],
      documented: 'Audi A4 2009–2016',
    });
    expect(r?.verdict).toBe('unverified');
    expect(r?.reason).toContain('Audi A4 2009–2016');
  });

  it('wrong side is explicit: "does not fit", even without a vehicle', () => {
    const r = decideVerdict({
      ...base,
      vehicle: null,
      evidence: [],
      title: 'Headlight Assembly Right RH',
      querySide: 'LEFT',
    });
    expect(r?.verdict).toBe('does_not_fit');
  });

  it('compatibility-list match is "likely"; universal parts say so', () => {
    expect(
      decideVerdict({
        ...base,
        vehicle: vehicle(),
        evidence: [],
        compatibilityListsVehicle: true,
      })?.verdict,
    ).toBe('likely');
    expect(
      decideVerdict({
        ...base,
        vehicle: vehicle(),
        evidence: [],
        hasAnyFitment: false,
        title: 'Universal LED bulb',
      })?.verdict,
    ).toBe('universal');
  });

  it('summarizes documented fitment compactly', () => {
    expect(
      summarizeDocumented([
        { make: 'Audi', model: 'Q5', minYear: 2009, maxYear: 2017 },
        { make: 'Audi', model: 'A4', minYear: 2010, maxYear: 2010 },
      ]),
    ).toBe('Audi A4 2010; Audi Q5 2009–2017');
  });
});

const offer = (overrides: Partial<InternalOffer> = {}): InternalOffer =>
  ({
    id: 'o',
    sellerId: 's',
    sellerName: 'Seller',
    sellerStoreId: null,
    sellerStatus: 'ACTIVE',
    status: 'ACTIVE',
    price: 50,
    sellerBasePrice: 40,
    currency: 'USD',
    condition: 'USED',
    partSource: 'OEM',
    qualityTier: 'USED',
    sourceTag: null,
    sourceKey: null,
    sellerSku: null,
    sellerTitle: null,
    externalOfferId: null,
    leadTimeDays: null,
    quantity: 2,
    warehouses: [
      {
        warehouseId: 'w',
        name: 'Main',
        location: 'Dubai',
        quantity: 2,
        status: 'AVAILABLE',
      },
    ],
    buyerVisible: true,
    outrankedBySuperior: false,
    updatedAt: '2026-10-27T00:00:00Z',
    ...overrides,
  }) as InternalOffer;

describe('availability', () => {
  it('in stock needs an active, priced offer with quantity', () => {
    const s = summarizeAvailability([
      offer(),
      offer({ id: 'o2', price: 70, condition: 'NEW', quantity: 1 }),
    ]);
    expect(s.status).toBe('in_stock');
    expect(s.totalQuantity).toBe(3);
    expect(s.priceMin).toBe(50);
    expect(s.priceMax).toBe(70);
    expect(s.bestCondition).toBe('NEW');
  });

  it('an ended offer is not available, even if the index still lists the part', () => {
    expect(summarizeAvailability([offer({ status: 'INACTIVE' })]).status).toBe(
      'not_available',
    );
    expect(summarizeAvailability([]).status).toBe('not_available');
  });

  it('no stock but a lead time means "can source"', () => {
    const s = summarizeAvailability([
      offer({ quantity: 0, warehouses: [], leadTimeDays: 5 }),
    ]);
    expect(s.status).toBe('can_source');
    expect(s.leadTimeDays).toBe(5);
  });
});

describe('manufacturer families', () => {
  it('groups makes that share part numbers', () => {
    const { makeFamilies } = jest.requireActual('./number-graph');
    expect(makeFamilies('CADILLAC')).toEqual(['GM']);
    expect(makeFamilies('CHEVROLET')).toEqual(['GM']);
    expect(makeFamilies('AUDI')).toEqual(['VAG']);
    expect(makeFamilies('OPEL').sort()).toEqual(['GM', 'STELLANTIS']);
    expect(makeFamilies('TATA')).toEqual(['TATA']);
  });
});

describe('matchesAsked (text precision)', () => {
  const { matchesAsked } = jest.requireActual('./portal-options.service');
  const { parseQuery } = jest.requireActual('../../query/query-parser');
  it('keeps titles naming the part or a synonym, and demotes the rest', () => {
    const q = parseQuery('front left headlight 2018 Audi Q5');
    expect(matchesAsked('2009-2013 Audi Q5 Headlight 8R0941030AF', q)).toBe(
      true,
    );
    expect(matchesAsked('Audi Q5 Head Lamp Assembly', q)).toBe(true);
    expect(matchesAsked('2009-2021 Audi Q5 Front Fender 8R0821106', q)).toBe(
      false,
    );
    expect(
      matchesAsked('Front brake pad set', parseQuery('brake pads bmw x5')),
    ).toBe(true);
    expect(matchesAsked('anything', parseQuery('2018 Audi Q5'))).toBe(true);
  });
});
