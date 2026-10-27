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
}

/** Brands that mean "genuine OEM" rather than an aftermarket manufacturer. */
const GENUINE_BRAND_RE = /^(genuine( oem)?|oem|oe|original|genuine parts?)$/i;

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

/** Split stored lists like "XR816247, 1R8E9K461CD" / "A;B" / "A|B". */
export function splitNumberList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;|]+/)
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
  for (const raw of part.oeNumbers ?? []) push(raw, 'OE', 'oe_numbers', false);
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
  return out;
}

export function isGenuinePart(
  part: Pick<NumberedPart, 'brand' | 'partSource'>,
): boolean {
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
  if (ref.role === 'OE') return 'part OE numbers (seller/catalogue data)';
  if (/FEBEST/i.test(ref.source)) return 'Febest catalogue';
  if (/SPREADSHEET/i.test(ref.source)) return 'seller spreadsheet';
  return ref.source || 'catalogue';
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
