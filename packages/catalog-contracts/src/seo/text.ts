/**
 * Text primitives shared by every SEO generator.
 *
 * These exist so that "never emit `undefined`, `null`, or a dangling
 * separator" is a property of the join helpers rather than a rule each
 * template has to remember. `joinParts` is the workhorse: give it a list that
 * may contain nulls and it produces clean prose or nothing at all.
 */

/** Collapse whitespace and coerce anything to a trimmed string. */
export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Guard against `[object Object]` and the literal strings "null"/"undefined"
  // leaking into a title from loosely-typed JSON columns.
  if (typeof value === 'object') return '';
  const raw = String(value).replace(/\s+/g, ' ').trim();
  if (!raw || raw === 'null' || raw === 'undefined' || raw === 'NaN') return '';
  return raw;
}

/**
 * Truncate at a word boundary and add an ellipsis, but only when the string
 * actually exceeds the limit — an exactly-at-limit title keeps its last word.
 */
export function clip(value: unknown, max: number): string {
  const normalized = text(value);
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, Math.max(1, max - 1));
  const atBoundary = cut.replace(/\s+\S*$/, '').trim();
  return `${atBoundary || cut.trim()}…`;
}

/** Truncate without an ellipsis — for slugs and ALT text, where "…" is noise. */
export function clipHard(value: unknown, max: number): string {
  const normalized = text(value);
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max);
  return (cut.replace(/\s+\S*$/, '').trim() || cut.trim());
}

/**
 * Join non-empty fragments with a separator. This is what prevents the
 * `Toyota | | Camera |` class of bug: empties are dropped before the join, so
 * a missing attribute shortens the string instead of leaving a hole.
 */
export function joinParts(
  parts: Array<unknown>,
  separator = ' ',
): string {
  return parts
    .map((part) => text(part))
    .filter(Boolean)
    .join(separator)
    .trim();
}

/** De-duplicate case-insensitively while preserving first-seen casing. */
export function uniqueStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/** `SALVAGE_OEM` / `front-left` → `Salvage oem` / `Front left`. */
export function humanizeToken(value: unknown): string {
  const normalized = text(value);
  if (!normalized) return '';
  const spaced = normalized.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Title Case for display labels (breadcrumbs, H1s, taxonomy names) that arrive
 * as lowercase or SCREAMING_CASE catalog values. Small words stay lowercase
 * unless they lead, and tokens containing digits are left alone so part
 * numbers and engine codes survive intact.
 */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on',
  'or', 'per', 'the', 'to', 'via', 'vs', 'with',
]);

export function titleCase(value: unknown): string {
  const normalized = text(value).replace(/[_]+/g, ' ');
  if (!normalized) return '';
  const words = normalized.split(/\s+/);
  return words
    .map((word, index) => {
      // Leave alphanumeric identifiers (86401-12020, 4WD, V6) untouched.
      if (/\d/.test(word)) return word;
      // An existing acronym stays an acronym.
      if (word.length <= 4 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
        return word;
      }
      const lower = word.toLowerCase();
      if (index > 0 && index < words.length - 1 && MINOR_WORDS.has(lower)) {
        return lower;
      }
      // Preserve internal hyphenation: "lane-departure" → "Lane-Departure".
      return lower
        .split('-')
        .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
        .join('-');
    })
    .join(' ');
}

/** Strip HTML to plain text without pulling in a parser dependency. */
export function stripHtml(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  return text(
    raw
      // Drop script/style bodies outright — their contents are never prose.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

/**
 * Case- and separator-insensitive comparison key for part numbers.
 * `86401-12020`, `86401 12020`, and `8640112020` are the same number.
 */
export function normalizeIdentifier(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Remove a fragment from a string when it appears as a whole word, used to
 * stop titles reading "Toyota Toyota Corolla" once the brand is prefixed
 * separately. Returns the original when removal would empty the string.
 */
export function removeRedundant(haystack: unknown, needle: unknown): string {
  const source = text(haystack);
  const fragment = text(needle);
  if (!source || !fragment) return source;
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = text(
    source.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'gi'), ' '),
  );
  return stripped || source;
}

/**
 * Marketing filler that scraped marketplace titles carry. It occupies the
 * title budget without adding a term anyone searches, and "Genuine OEM …
 * NEW" duplicates information the page states properly elsewhere (the part
 * source row, the condition badge, the OEM-number clause in the H1).
 *
 * Only stripped at the *edges* of a name, never from the middle: a mid-string
 * "new" is far more likely to be part of a real product or model name.
 */
const NOISE_PHRASES = [
  'brand new', 'genuine oem', 'genuine', 'original oem', 'original', 'oem',
  'authentic', 'new', 'high quality', 'top quality', 'best quality', 'quality',
  'free shipping', 'fast shipping', 'hot sale', 'on sale', 'sale', 'premium',
  'universal', '100%', 'oe', 'aftermarket',
];

/**
 * Strip marketing filler from the head and tail of a descriptive name.
 * Returns the original string if stripping would leave nothing — a listing
 * literally titled "Genuine OEM" keeps that as its name rather than losing it.
 */
export function stripListingNoise(value: unknown): string {
  let current = text(value);
  if (!current) return '';

  let changed = true;
  while (changed) {
    changed = false;
    for (const phrase of NOISE_PHRASES) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const head = new RegExp(`^${escaped}\\b[\\s,\\-–—/|]*`, 'i');
      const tail = new RegExp(`[\\s,\\-–—/|]*\\b${escaped}$`, 'i');
      for (const pattern of [head, tail]) {
        const next = text(current.replace(pattern, ' '));
        if (next && next !== current) {
          current = next;
          changed = true;
        }
      }
    }
  }

  return current || text(value);
}

/**
 * Remove words that already appeared earlier in the string, so composing
 * "brand + vehicle + name" cannot stutter into "Toyota Toyota Corolla".
 * Tokens containing digits are exempt — a part number may legitimately repeat
 * a group, and clipping one would corrupt it.
 */
export function dedupeWords(value: unknown): string {
  const normalized = text(value);
  if (!normalized) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of normalized.split(/\s+/)) {
    const key = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || /\d/.test(word)) {
      out.push(word);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out.join(' ');
}

/**
 * Values that occupy the `brand` column but are not brands.
 *
 * This catalog uses `brand` for a part-source label on a meaningful slice of
 * inventory — "Genuine OEM" on ~14 900 listings and "ORIGINAL" on ~5 000.
 * Trusting those blindly produces `/parts/genuine-oem-bmw-x6-front-bumper-…`
 * slugs and, worse, mints an indexable `/brands/genuine-oem` landing page that
 * would comfortably clear the inventory threshold while meaning nothing.
 *
 * The condition/source information is not lost — it is already carried
 * properly by `partSource`, `qualityTier`, and the condition badge.
 */
const NON_BRAND_LABELS = new Set([
  'genuineoem', 'genuine', 'oem', 'oe', 'oempart', 'oemgenuine', 'genuinepart',
  'original', 'originalpart', 'originalequipment', 'aftermarket',
  'unbranded', 'nobrand', 'noname', 'generic', 'universal', 'standard',
  'replacement', 'quality', 'unknown', 'none', 'na', 'n', 'various', 'misc',
  'other', 'assorted', 'default', 'null', 'undefined',
]);

/**
 * True when a `brand` value names an actual manufacturer rather than a
 * condition or provenance label. Used everywhere a brand would become
 * user-visible or URL-visible: slugs, titles, breadcrumbs, `Brand` JSON-LD,
 * and brand taxonomy pages.
 */
export function isMeaningfulBrand(value: unknown): boolean {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return false;
  // A single character is never a brand a buyer would search for.
  if (normalized.length < 2) return false;
  return !NON_BRAND_LABELS.has(normalized);
}

/** The brand if it names a manufacturer, otherwise an empty string. */
export function meaningfulBrand(value: unknown): string {
  return isMeaningfulBrand(value) ? text(value) : '';
}

/** Sentence-ends a description so meta text does not read as a fragment. */
export function endSentence(value: unknown): string {
  const normalized = text(value);
  if (!normalized) return '';
  return /[.!?…]$/.test(normalized) ? normalized : `${normalized}.`;
}
