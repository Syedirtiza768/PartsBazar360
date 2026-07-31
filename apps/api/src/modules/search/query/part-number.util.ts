/**
 * Part-number normalization for automotive search.
 *
 * Design rules (brief §4):
 *  - Normalization is for *matching only*. Original values are never mutated;
 *    callers keep them for display and audit.
 *  - Normalization must not be so aggressive that unrelated numbers collide.
 *    Collapsing separators inevitably creates some collisions (`12-345` and
 *    `1234-5` both collapse to `12345`), so every variant carries a
 *    confidence and the ranking layer scores the exact original above the
 *    collapsed form. `partNumberConfidence()` exposes that signal.
 */

/** Separator-insensitive matching key. NFKC → upper → alphanumerics only. */
export function normalizePartNumber(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Prefixes sellers bolt onto a number that are not part of the manufacturer's
 * identity. Stripped only as an *additional* variant — never in place of the
 * full form, so a genuine number beginning with these letters still matches.
 */
const SELLER_PREFIXES = [
  'OEM',
  'OE',
  'GENUINE',
  'ORIGINAL',
  'NEW',
  'USED',
  'PN',
  'PART',
  'PARTNO',
  'PARTNUMBER',
  'SKU',
  'REF',
  'NO',
];

/** Tokens that look numeric but are never part numbers on their own. */
const YEAR_RE = /^(19[5-9]\d|20[0-4]\d)$/;
/** "2015-2018" is a model-year range, not a part number. */
const YEAR_RANGE_TOKEN_RE =
  /^(19[5-9]\d|20[0-4]\d)[-–—/](19[5-9]\d|20[0-4]\d)$/;

/**
 * All forms of `value` worth probing the index with, most-specific first.
 * De-duplicated and stable-ordered so query construction is deterministic.
 */
export function partNumberVariants(value: unknown): string[] {
  const base = normalizePartNumber(value);
  if (!base) return [];

  const out: string[] = [base];
  const push = (v: string) => {
    if (v && v.length >= 3 && !out.includes(v)) out.push(v);
  };

  // Seller/manufacturer prefix stripped: "OEM8640112020" → "8640112020".
  for (const prefix of SELLER_PREFIXES) {
    if (base.startsWith(prefix) && base.length > prefix.length + 2) {
      push(base.slice(prefix.length));
    }
  }

  // Leading zeros are frequently added or dropped between catalogues.
  const noLeadingZeros = base.replace(/^0+/, '');
  if (noLeadingZeros.length >= 4) push(noLeadingZeros);

  return out;
}

/**
 * Heuristic: does this token look like a part number rather than a word?
 *
 * Requires at least one digit and one of:
 *  - ≥5 characters (most OEM numbers), or
 *  - a letter/digit mix of ≥4 characters (short aftermarket SKUs like "0125-141").
 *
 * Years and bare 1–3 digit numbers are explicitly excluded so "2019" and "4"
 * are never treated as part numbers.
 */
export function looksLikePartNumber(token: string): boolean {
  const raw = String(token ?? '').trim();
  if (!raw) return false;
  // Only characters that legitimately appear in part numbers.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/\\-]*$/.test(raw)) return false;
  if (YEAR_RANGE_TOKEN_RE.test(raw)) return false;

  const norm = normalizePartNumber(raw);
  if (norm.length < 4) return false;
  if (YEAR_RE.test(norm)) return false;
  if (!/\d/.test(norm)) return false;
  // A pure number under 5 digits is more likely a size/quantity than a part.
  if (/^\d+$/.test(norm) && norm.length < 5) return false;

  return true;
}

/**
 * Confidence that a *normalized* match is the same physical part.
 *
 * A number that needed no collapsing is trusted fully. The more separators we
 * had to remove and the shorter the result, the more likely an accidental
 * collision, so confidence decays. Consumed by the ranking layer.
 */
export function partNumberConfidence(original: string): number {
  const raw = String(original ?? '').trim();
  const norm = normalizePartNumber(raw);
  if (!norm) return 0;

  const stripped = raw.length - norm.length;
  let score = 1;
  if (stripped > 0) score -= Math.min(0.25, stripped * 0.05);
  if (norm.length <= 5) score -= 0.3;
  else if (norm.length <= 7) score -= 0.1;

  return Math.max(0.3, Math.round(score * 100) / 100);
}

/** A part-number candidate plus the query token indices it was built from. */
export interface PartNumberCandidate {
  /** Normalized matching key. */
  value: string;
  /** Indices into the whitespace-split query that produced this candidate. */
  tokenIndices: number[];
}

/**
 * Extract part-number candidates from a free-text query, recording which query
 * tokens each candidate consumed so the caller can remove them from the
 * descriptive remainder.
 *
 * Two passes:
 *  1. Individual tokens that look like part numbers.
 *  2. Runs of adjacent short groups joined together — this is how manufacturers
 *     actually print numbers ("A 221 820 02 64" → A2218200264, "86401 12020" →
 *     8640112020). Without this pass those queries collapse into unrelated
 *     token matches, the production defect in docs/SEARCH_PHASE1_AUDIT.md §3.1.
 *
 * A group qualifies for pass 2 only if it contains a digit, or is a ≤2-letter
 * alpha prefix (the "A" in "A 221 820 02 64"). That rule is what stops
 * "2019 Toyota" from being joined into the bogus candidate "2019TOYOTA".
 */
export function extractPartNumberCandidatesDetailed(
  query: string,
): PartNumberCandidate[] {
  const text = String(query ?? '').trim();
  if (!text) return [];

  const tokens = text.split(/\s+/).filter(Boolean);
  const found: PartNumberCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string, tokenIndices: number[]) => {
    const value = normalizePartNumber(raw);
    if (value.length < 4 || seen.has(value)) return;
    seen.add(value);
    found.push({ value, tokenIndices });
  };

  // Pass 1 — standalone tokens.
  tokens.forEach((token, index) => {
    if (looksLikePartNumber(token)) add(token, [index]);
  });

  // Pass 2 — joined runs.
  const isGroup = (t: string) =>
    /^[A-Za-z0-9]{1,6}$/.test(t) && (/\d/.test(t) || /^[A-Za-z]{1,2}$/.test(t));

  let run: Array<{ token: string; index: number }> = [];
  const flush = () => {
    if (run.length >= 2) {
      const joined = run.map((r) => r.token).join('');
      const norm = normalizePartNumber(joined);
      if (norm.length >= 7 && /\d/.test(norm)) {
        add(joined, run.map((r) => r.index));
      }
    }
    run = [];
  };
  tokens.forEach((token, index) => {
    if (isGroup(token)) run.push({ token, index });
    else flush();
  });
  flush();

  // A joined run subsumes the individual groups that built it: "86401 12020"
  // means the single number 8640112020, not the two numbers 86401 and 12020.
  // Without this, the spaced form probes three numbers while the hyphenated
  // form probes one, and the brief's equivalence requirement (§4) fails.
  const joinedSpans = found.filter((c) => c.tokenIndices.length > 1);
  return found.filter(
    (candidate) =>
      candidate.tokenIndices.length > 1 ||
      !joinedSpans.some((span) =>
        candidate.tokenIndices.every((index) => span.tokenIndices.includes(index)),
      ),
  );
}

/** Normalized part-number candidates, most confident first, de-duplicated. */
export function extractPartNumberCandidates(query: string): string[] {
  return extractPartNumberCandidatesDetailed(query).map((c) => c.value);
}
