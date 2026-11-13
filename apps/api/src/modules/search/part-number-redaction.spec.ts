/**
 * Phone-number redaction must not erase the listing's own part numbers, and
 * part-number search must accept the Mercedes "A" prefix.
 */
import {
  listingPartNumbers,
  sanitizeBuyerSpecifics,
  sanitizeBuyerText,
  sanitizeSearchItem,
  type SearchItemLike,
} from './buyer-visible-offers.util';
import { partNumberVariants } from './query/part-number.util';
import {
  extractOeNumbers,
  looksLikeOeNumber,
} from '../ingestion/listing-parser.util';

describe('part-number-safe redaction', () => {
  it('keeps an all-digit part number that follows a "Part Number" label', () => {
    expect(
      sanitizeBuyerText(
        'Auxiliary Battery 12V/12AH — Part Number 2115410001, brand ORIGINAL.',
      ),
    ).toBe(
      'Auxiliary Battery 12V/12AH — Part Number 2115410001, brand ORIGINAL.',
    );
  });

  it('keeps spaced and slash-suffixed part numbers', () => {
    expect(sanitizeBuyerText('Part Number 230 541 00 01, brand X.')).toContain(
      '230 541 00 01',
    );
    expect(sanitizeBuyerText('Hydromount 2133331300/64 for W213')).toContain(
      '2133331300/64',
    );
  });

  it("keeps the listing's own numbers wherever they appear", () => {
    expect(
      sanitizeBuyerText('Fits as 34106891080 front pads.', [], null, true, [
        '34106891080',
      ]),
    ).toContain('34106891080');
  });

  it('still removes phone numbers', () => {
    expect(
      sanitizeBuyerText('Call +971 50 123 4567 for stock.', [], null, true, [
        '2115410001',
      ]),
    ).toBe('Call for stock.');
    expect(sanitizeBuyerText('WhatsApp 0501234567 today')).toBe(
      'WhatsApp today',
    );
  });

  it('keeps part numbers inside detail bullets', () => {
    const specifics = sanitizeBuyerSpecifics(
      { detailBullets: 'Brand: ORIGINAL\nPart Number: 2115410001' },
      [],
      null,
      ['2115410001'],
    );
    expect(specifics?.detailBullets).toContain('Part Number: 2115410001');
  });

  it('protects numbers in search results', () => {
    const item = sanitizeSearchItem<SearchItemLike>({
      id: 'p1',
      description: 'Thermostat — Part Number 2602004500, brand ORIGINAL.',
      manufacturerPartNumber: '2602004500',
      offers: [
        {
          id: 'o1',
          sellerId: 'seller-superior-auto-parts',
          sellerName: 'Superior Auto Parts',
          price: 10,
        },
      ],
    });
    expect(item?.description).toContain('2602004500');
  });

  it('collects MPN, genuine OE and OE numbers', () => {
    expect(
      listingPartNumbers({
        manufacturerPartNumber: '2115410001',
        genuineOemPartNumber: null,
        oeNumbers: ['A0009829608'],
      }),
    ).toEqual(['2115410001', 'A0009829608']);
  });
});

describe('Mercedes A-prefix search variant', () => {
  it('adds the bare number for an A-prefixed Mercedes number', () => {
    expect(partNumberVariants('A2115410001')).toContain('2115410001');
    expect(partNumberVariants('A 211 541 00 01')).toContain('2115410001');
  });

  it('does not strip a leading A from non-Mercedes numbers', () => {
    expect(partNumberVariants('A12345')).not.toContain('12345');
  });
});

describe('OE extraction from catalogue titles', () => {
  it('ignores the part name after an "OE" prefix', () => {
    expect(extractOeNumbers('OE CARRIER – 6422000200')).not.toContain(
      'CARRIER',
    );
    expect(extractOeNumbers('OE AUXILIARY BATTERY 12V/12AH – 2115410001')).not.toContain(
      'AUXILIARY',
    );
  });

  it('ignores name-with-suffix tokens like HOSE-6 and COOLING-X5', () => {
    const oe = extractOeNumbers(
      'OE RADIATOR,ENG COOLING-X5(E70) – 17117533472 HOSE-6',
    );
    expect(oe).not.toContain('COOLING-X5');
    expect(oe).not.toContain('HOSE-6');
  });

  it('still extracts real OE numbers', () => {
    expect(extractOeNumbers('OEM 4L0805697 front bracket')).toContain(
      '4L0805697',
    );
    expect(extractOeNumbers('OE PORSCHE CAYENE BRK PAD ST FR – PAA698151')).toContain(
      'PAA698151',
    );
  });

  it('classifies tokens', () => {
    expect(looksLikeOeNumber('LR070870')).toBe(true);
    expect(looksLikeOeNumber('LIGHTING-C218')).toBe(false);
    expect(looksLikeOeNumber('2019')).toBe(false);
  });
});
