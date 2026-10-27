/**
 * Part-number equivalence for staff search ("every sellable option").
 *
 * Production reality this is built around (measured 2026-10-27):
 * - `CanonicalPart.manufacturerPartNumber` on ~267k parts and `oeNumbers` on
 *   ~250k; `oeNumbers` mixes formats ("63-31-9-263-453") and comma-joined
 *   strings ("XR816247, 1R8E9K461CD"), so every value is split + normalized.
 * - `CatalogPartNumber` holds BRAND_MPN (seller spreadsheets) and
 *   OEM_CROSS_REFERENCE (Febest website) rows, all unverified, confidence 0.55.
 *   SUPERSEDED / VERIFIED rows do not exist yet; the rules below already
 *   handle them so they take effect as soon as the data does.
 * - `itemSpecifics` (listing aspects, ~132k parts) is the richest role-tagged
 *   source: interchange numbers on ~20k parts, superseded numbers on ~19k,
 *   OE/OEM numbers incl. German/French/Italian/Spanish keys. Imports copied
 *   most of them into `oeNumbers`, which loses the role (a superseded number
 *   looked like a plain OE number), and ~5k values exist only here. See
 *   ITEM_SPECIFIC_NUMBER_KEYS; the SQL lookup function mirrors that list.
 *
 * Relations, strongest first:
 *   exact                 – the part *is* the queried number (MPN / BRAND_MPN / OEM)
 *   superseded            – the queried number is recorded as superseded by/for it
 *   oem_equivalent        – an OEM part lists the queried number among its OE numbers
 *   aftermarket_equivalent– an aftermarket part declares it replaces the queried number
 *   possible              – reached one hop further through an *unverified* number,
 *                           or the same digits on a part of another make
 */

import { normalizePartNumber } from '../../query/part-number.util';

export type NumberRole =
  | 'MPN'
  | 'BRAND_MPN'
  | 'OEM'
  | 'OE'
  | 'OEM_CROSS_REFERENCE'
  | 'INTERCHANGE'
  | 'SUPERSEDED';

export type Relation =
  | 'exact'
  | 'superseded'
  | 'oem_equivalent'
  | 'aftermarket_equivalent'
  | 'possible';

export const RELATION_ORDER: Relation[] = [
  'exact',
  'superseded',
  'oem_equivalent',
  'aftermarket_equivalent',
  'possible',
];

export interface PartNumberRef {
  /** Normalized (A-Z0-9). */
  number: string;
  /** As stored, for display. */
  display: string;
  role: NumberRole;
  source: string;
  /** Verified identity or verified cross-reference (safe to expand through twice). */
  verified: boolean;
}

export interface CatalogNumberRow {
  displayNumber: string;
  normalizedNumber: string;
  numberType: string;
  source: string;
  verificationStatus: string;
  confidence: number;
}

export interface NumberedPart {
  id: string;
  brand: string | null;
  partSource: string | null;
  manufacturerPartNumber: string | null;
  oeNumbers: string[] | null;
  catalogNumbers?: CatalogNumberRow[];
  /** Number-bearing listing aspects, see itemSpecificNumbers(). */
  specificNumbers?: SpecificNumber[];
  /** Listing aspect says the part is genuine OEM ("Genuine OEM: Yes"). */
  genuineFlag?: boolean;
}

/** Brands that mean "genuine OEM" rather than an aftermarket manufacturer. */
const GENUINE_BRAND_RE = /^(genuine( oem)?|oem|oe|original|genuine parts?)$/i;

/**
 * Listing aspects (CanonicalPart.itemSpecifics keys, as stored by the eBay and
 * marketplace importers) that carry part numbers, by role. Keys that look like
 * numbers but are not part numbers (partOutID, referenceNumber = quantity,
 * vINNumber) are deliberately absent.
 *
 * KEEP IN SYNC with pb_part_numbers() in
 * prisma/migrations/20261027120000_part_numbers_lookup (the indexed lookup).
 */
export const ITEM_SPECIFIC_NUMBER_KEYS: Record<string, NumberRole> = {
  mpn: 'BRAND_MPN',
  manufacturerPartNumber: 'BRAND_MPN',
  numeroparteproduttore: 'BRAND_MPN',
  officialArticleNumber: 'BRAND_MPN',
  oeNumber: 'OE',
  oEPartNumber: 'OE',
  OE_numbers: 'OE',
  otherPartNumber: 'OE',
  'numeroparteOE/OEM': 'OE',
  'numérodepièceOE/OEM': 'OE',
  'oE/OEMTeilenummer': 'OE',
  'númerodepiezaOE/OEM': 'OE',
  interchangePartNumber: 'INTERCHANGE',
  interchangeNumbers: 'INTERCHANGE',
  numeropartediscambio: 'INTERCHANGE',
  supersededPartNumber: 'SUPERSEDED',
  supersedes: 'SUPERSEDED',
  numeropartesostituito: 'SUPERSEDED',
};

const GENUINE_FLAG_KEYS = ['genuineOEM', 'oEM'];

export interface SpecificNumber {
  key: string;
  role: NumberRole;
  value: string;
}

/** Number-bearing values of a part's listing aspects (strings or arrays). */
export function itemSpecificNumbers(specifics: unknown): SpecificNumber[] {
  if (!specifics || typeof specifics !== 'object' || Array.isArray(specifics))
    return [];
  const out: SpecificNumber[] = [];
  for (const [key, role] of Object.entries(ITEM_SPECIFIC_NUMBER_KEYS)) {
    const raw = (specifics as Record<string, unknown>)[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === 'string' && value.trim())
        out.push({ key, role, value: value.trim() });
    }
  }
  return out;
}

/** "Genuine OEM: Yes" / "OEM: Ja" on the listing. */
export function itemSpecificGenuine(specifics: unknown): boolean {
  if (!specifics || typeof specifics !== 'object') return false;
  return GENUINE_FLAG_KEYS.some((key) =>
    /^(yes|ja|si|sí|oui|true)$/i.test(
      String((specifics as Record<string, unknown>)[key] ?? '').trim(),
    ),
  );
}

/**
 * A number is safe to match/expand on only when it can plausibly identify one
 * part: ≥ 5 alphanumerics, at least one digit, not a run of one character.
 */
export function isSignificantNumber(normalized: string): boolean {
  if (!normalized || normalized.length < 5) return false;
  if (!/[0-9]/.test(normalized)) return false;
  if (/^(.)\1+$/.test(normalized)) return false;
  return true;
}

/** Split stored lists like "XR816247, 1R8E9K461CD" / "A;B" / "A|B" / one per line. */
export function splitNumberList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;|\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isVerifiedCatalogRow(row: CatalogNumberRow): boolean {
  return (
    row.verificationStatus === 'VERIFIED' ||
    (Number(row.confidence) >= 0.9 &&
      !/SELLER|SPREADSHEET|TITLE/i.test(row.source || ''))
  );
}

function roleOfCatalogRow(numberType: string): NumberRole | null {
  switch (numberType) {
    case 'BRAND_MPN':
      return 'BRAND_MPN';
    case 'OEM':
      return 'OEM';
    case 'OEM_CROSS_REFERENCE':
      return 'OEM_CROSS_REFERENCE';
    case 'INTERCHANGE':
      return 'INTERCHANGE';
    case 'SUPERSEDED':
      return 'SUPERSEDED';
    default:
      // SELLER_SKU and unknown types are never used for equivalence.
      return null;
  }
}

/** Every number a part carries, normalized, de-duplicated by (number, role). */
export function numbersOfPart(part: NumberedPart): PartNumberRef[] {
  const out: PartNumberRef[] = [];
  const seen = new Set<string>();
  const push = (
    raw: unknown,
    role: NumberRole,
    source: string,
    verified: boolean,
  ) => {
    for (const display of splitNumberList(raw)) {
      const number = normalizePartNumber(display);
      if (!number) continue;
      const key = `${number}|${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ number, display, role, source, verified });
    }
  };
  // The part's own number is its identity, not a claim about another part.
  push(part.manufacturerPartNumber, 'MPN', 'part', true);
  for (const row of part.catalogNumbers ?? []) {
    const role = roleOfCatalogRow(row.numberType);
    if (!role) continue;
    push(
      row.displayNumber || row.normalizedNumber,
      role,
      row.source || 'catalog',
      isVerifiedCatalogRow(row),
    );
  }
  // Role-tagged listing aspects before the untyped oeNumbers copy, so the
  // first ref found for a number carries its real role (superseded, …).
  for (const spec of part.specificNumbers ?? [])
    push(spec.value, spec.role, `item_specifics:${spec.key}`, false);
  for (const raw of part.oeNumbers ?? []) push(raw, 'OE', 'oe_numbers', false);
  return out;
}

/** Strongest role first: what a number *is* on a part when it appears twice. */
const ROLE_STRENGTH: NumberRole[] = [
  'MPN',
  'BRAND_MPN',
  'OEM',
  'SUPERSEDED',
  'INTERCHANGE',
  'OEM_CROSS_REFERENCE',
  'OE',
];

/** Lower = stronger. */
export function roleStrength(role: NumberRole): number {
  return ROLE_STRENGTH.indexOf(role);
}

/** The strongest ref of a part for one of the given numbers. */
export function strongestRef(
  refs: PartNumberRef[],
  numbers: { has(number: string): boolean },
): PartNumberRef | undefined {
  return refs
    .filter((ref) => numbers.has(ref.number))
    .sort((a, b) => roleStrength(a.role) - roleStrength(b.role))[0];
}

/** One ref per number — its strongest role — in role order. */
export function distinctNumbers(refs: PartNumberRef[]): PartNumberRef[] {
  const byNumber = new Map<string, PartNumberRef>();
  for (const ref of refs) {
    const existing = byNumber.get(ref.number);
    if (!existing || roleStrength(ref.role) < roleStrength(existing.role))
      byNumber.set(ref.number, ref);
  }
  return [...byNumber.values()].sort(
    (a, b) => roleStrength(a.role) - roleStrength(b.role),
  );
}

export function isGenuinePart(
  part: Pick<NumberedPart, 'brand' | 'partSource' | 'genuineFlag'>,
): boolean {
  if (part.genuineFlag) return true;
  if (part.brand && GENUINE_BRAND_RE.test(part.brand.trim())) return true;
  return (part.partSource ?? '').toUpperCase() === 'OEM';
}

export interface DirectMatch {
  relation: Relation;
  /** The number on the part that matched the query. */
  matched: PartNumberRef;
}

/**
 * How a part relates to the queried numbers when it carries one of them
 * itself (hop 0). Returns null when it carries none.
 */
export function classifyDirect(
  part: NumberedPart,
  query: Set<string>,
): DirectMatch | null {
  const refs = numbersOfPart(part).filter((ref) => query.has(ref.number));
  if (!refs.length) return null;
  const pick = (roles: NumberRole[]) =>
    refs.find((ref) => roles.includes(ref.role));
  const identity = pick(['MPN', 'BRAND_MPN', 'OEM']);
  if (identity) return { relation: 'exact', matched: identity };
  const superseded = pick(['SUPERSEDED']);
  if (superseded) return { relation: 'superseded', matched: superseded };
  const reference =
    pick(['OE', 'OEM_CROSS_REFERENCE', 'INTERCHANGE']) ?? refs[0];
  return {
    relation: isGenuinePart(part) ? 'oem_equivalent' : 'aftermarket_equivalent',
    matched: reference,
  };
}

/**
 * Numbers to expand through from a directly matched part (hop 1).
 * Only significant numbers, never the queried ones.
 */
export function expansionNumbers(
  part: NumberedPart,
  query: Set<string>,
): PartNumberRef[] {
  return numbersOfPart(part).filter(
    (ref) => !query.has(ref.number) && isSignificantNumber(ref.number),
  );
}

export interface TrailStep {
  /** Display form of the number this step goes through. */
  number: string;
  /** Role phrase, e.g. "is listed as an OE number on". */
  relation: string;
  /** The part this step lands on. */
  partId: string;
  partLabel: string;
  /** Where the number on the landing part comes from. */
  source: string;
  /** Ready-to-render sentence, e.g. "8640112020 is listed as an OE number on Febest 0128-ZZT240". */
  text: string;
}

const ROLE_PHRASE: Record<NumberRole, string> = {
  MPN: 'is the part number of',
  BRAND_MPN: 'is the brand part number of',
  OEM: 'is the OEM number of',
  OE: 'is listed as an OE number on',
  OEM_CROSS_REFERENCE: 'is cross-referenced (OEM) by',
  INTERCHANGE: 'is an interchange number of',
  SUPERSEDED: 'is superseded on',
};

export function describeRef(ref: PartNumberRef): string {
  return ROLE_PHRASE[ref.role];
}

export function sourceLabel(ref: PartNumberRef): string {
  if (ref.role === 'MPN') return 'part record';
  if (ref.source.startsWith('item_specifics:'))
    return `listing item specifics (${ref.source.slice('item_specifics:'.length)})`;
  if (ref.role === 'OE') return 'part OE numbers (seller/catalogue data)';
  if (/FEBEST/i.test(ref.source)) return 'Febest catalogue';
  if (/SPREADSHEET/i.test(ref.source)) return 'seller spreadsheet';
  return ref.source || 'catalogue';
}

/**
 * Manufacturer families whose makes legitimately share part numbers
 * (`VehicleMake.manufacturerGroup` is empty in production, 2026-10-27).
 * Keys and members are normalizeMvlToken() forms. A make can sit in more than
 * one family (Opel/Vauxhall moved from GM to Stellantis).
 */
const MAKE_FAMILIES: Record<string, string[]> = {
  GM: [
    'CHEVROLET',
    'CADILLAC',
    'GMC',
    'BUICK',
    'PONTIAC',
    'SATURN',
    'HUMMER',
    'OLDSMOBILE',
    'OPEL',
    'VAUXHALL',
    'HOLDEN',
    'DAEWOO',
  ],
  VAG: [
    'AUDI',
    'VOLKSWAGEN',
    'VW',
    'SKODA',
    'SEAT',
    'CUPRA',
    'PORSCHE',
    'BENTLEY',
    'LAMBORGHINI',
    'BUGATTI',
  ],
  TOYOTA: ['TOYOTA', 'LEXUS', 'SCION', 'DAIHATSU'],
  NISSAN: ['NISSAN', 'INFINITI', 'DATSUN'],
  HONDA: ['HONDA', 'ACURA'],
  HYUNDAI: ['HYUNDAI', 'KIA', 'GENESIS'],
  FORD: ['FORD', 'LINCOLN', 'MERCURY'],
  BMW: ['BMW', 'MINI', 'ROLLSROYCE'],
  MERCEDES: ['MERCEDESBENZ', 'MERCEDES', 'SMART', 'MAYBACH'],
  JLR: ['JAGUAR', 'LANDROVER', 'RANGEROVER'],
  STELLANTIS: [
    'CHRYSLER',
    'DODGE',
    'JEEP',
    'RAM',
    'FIAT',
    'ALFAROMEO',
    'MASERATI',
    'LANCIA',
    'PEUGEOT',
    'CITROEN',
    'DS',
    'OPEL',
    'VAUXHALL',
    'ABARTH',
  ],
  RENAULT: ['RENAULT', 'DACIA'],
  VOLVO: ['VOLVO', 'POLESTAR'],
};

/** Families a (normalized) make belongs to; unknown makes are their own family. */
export function makeFamilies(normalizedMake: string): string[] {
  if (!normalizedMake) return [];
  const families = Object.entries(MAKE_FAMILIES)
    .filter(([, members]) => members.includes(normalizedMake))
    .map(([family]) => family);
  return families.length ? families : [normalizedMake];
}

/** Levenshtein distance, bounded (for "did you mean"). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
