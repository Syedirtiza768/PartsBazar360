/**
 * Deterministic part-type classification from listing titles.
 *
 * The catalogue has no part-type dimension: `partType` holds provenance
 * (SALVAGE_OEM / GENUINE_OEM / AFTERMARKET) and `category` is 44 % "General"
 * and polluted with make names. See docs/SEARCH_PHASE1_AUDIT.md §4 RC-5.
 *
 * This derives one from the synonym dictionary that already exists for query
 * understanding, so the vocabulary a buyer searches with and the vocabulary the
 * facet is built from are the same list — a query for "taillight" and the
 * "Tail light" facet bucket can never disagree.
 *
 * Rules:
 *  - Longest match wins ("brake disc" beats "brake"), so a more specific part
 *    type is never shadowed by a generic one.
 *  - Matching is whole-word on a normalized title. No stemming, no fuzziness:
 *    a facet value must be exactly right or absent.
 *  - Unmatched titles return `null`. An unclassified part is left out of the
 *    facet rather than dumped into a catch-all bucket, which is what made
 *    `category = "General"` useless.
 */

import { SYNONYM_GROUPS } from '../query/automotive-vocabulary';

/**
 * Words that are acronyms rather than short words. Listed explicitly — a
 * "shorter than N characters" rule turns "pad" into "PAD". Declared before
 * PART_TYPE_TERMS because that constant calls toTitleCase() at module init.
 */
const ACRONYMS = new Set(['ecu', 'ecm', 'tcm', 'abs', 'ac', 'a/c', 'cv', 'maf', 'o2', 'srs', 'ps']);

/** Canonical part-type label → every surface form that implies it. */
const PART_TYPE_TERMS: ReadonlyArray<{ label: string; terms: readonly string[] }> =
  SYNONYM_GROUPS.map((group) => ({
    // The first entry of each synonym group is its canonical label.
    label: toTitleCase(group[0]),
    terms: group,
  }));

/**
 * Flattened (term → label) pairs, longest term first so "brake disc" is tested
 * before "brake" and "lane departure camera" before "camera".
 */
const ORDERED_TERMS: ReadonlyArray<{ term: string; label: string }> = PART_TYPE_TERMS.flatMap(
  ({ label, terms }) => terms.map((term) => ({ term: term.toLowerCase(), label })),
).sort((a, b) => b.term.length - a.term.length);

function toTitleCase(value: string): string {
  return value
    .split(' ')
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** Lowercase, fold accents, collapse punctuation to spaces. */
export function normalizeTitleForClassification(title: unknown): string {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify a title into a canonical part type, or `null` when nothing matches
 * confidently.
 */
export function classifyPartType(title: unknown): string | null {
  const normalized = normalizeTitleForClassification(title);
  if (!normalized) return null;

  const padded = ` ${normalized} `;
  for (const { term, label } of ORDERED_TERMS) {
    if (padded.includes(` ${term} `)) return label;
  }
  return null;
}

/** Every part-type label the classifier can emit. Stable, for tests and docs. */
export function knownPartTypes(): string[] {
  return [...new Set(PART_TYPE_TERMS.map((entry) => entry.label))].sort();
}

/** Side extracted from a title, for the side facet. */
export function classifySide(title: unknown): 'LEFT' | 'RIGHT' | null {
  const padded = ` ${normalizeTitleForClassification(title)} `;
  const left = /\s(lh|l\/h|left|left hand|driver side|drivers side|nearside)\s/;
  const right = /\s(rh|r\/h|right|right hand|passenger side|offside)\s/;
  const hasLeft = left.test(padded);
  const hasRight = right.test(padded);
  // A title naming both sides ("LH/RH pair") is not a single-side part.
  if (hasLeft === hasRight) return null;
  return hasLeft ? 'LEFT' : 'RIGHT';
}

/** Positions extracted from a title, for the placement facet. */
export function classifyPositions(title: unknown): string[] {
  const padded = ` ${normalizeTitleForClassification(title)} `;
  const found: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/\s(front|fr)\s/, 'FRONT'],
    [/\s(rear|back|rr)\s/, 'REAR'],
    [/\s(upper|top)\s/, 'UPPER'],
    [/\s(lower|bottom)\s/, 'LOWER'],
    [/\s(inner|inside)\s/, 'INNER'],
    [/\s(outer|outside)\s/, 'OUTER'],
    [/\s(center|centre|middle)\s/, 'CENTER'],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(padded)) found.push(label);
  }
  return found;
}
