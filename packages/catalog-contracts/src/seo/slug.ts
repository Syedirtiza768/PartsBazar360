/**
 * Slug generation — the foundation of the URL architecture.
 *
 * Two rules govern everything here:
 *
 *  1. **Slugs are assigned once and then frozen.** A slug is persisted on the
 *     part row; editing a title does not move the URL. Regeneration is an
 *     explicit, audited act that writes the old slug to history so a 301 can
 *     be served. This is why `buildPartSlugBase` is only ever called for a
 *     part that has no slug yet (or an explicit regenerate).
 *
 *  2. **Uniqueness is deterministic, not sequential.** When a base collides we
 *     append a short, stable token derived from the part's own id rather than
 *     an incrementing counter. Two concurrent importers therefore compute the
 *     same slug for the same part, and re-running a backfill is idempotent —
 *     a counter would hand the same part a different URL on every run.
 */

import { seoConfig } from './config';
import {
  clipHard,
  meaningfulBrand,
  normalizeIdentifier,
  removeRedundant,
  text,
  uniqueStrings,
} from './text';
import type { SeoPartInput, SeoTaxonomyKind } from './types';

/**
 * Transliterations for the characters that actually appear in this catalog's
 * European supplier titles and survive NFKD decomposition unchanged. Without
 * these, "Öl" collapses to "l" and "Größe" to "groe" — silently losing a
 * keyword rather than transliterating it.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ø: 'o',
  Ø: 'o',
  đ: 'd',
  Đ: 'd',
  ł: 'l',
  Ł: 'l',
  ħ: 'h',
  ı: 'i',
  '&': ' and ',
  '+': ' plus ',
  '½': ' half ',
  '°': ' deg ',
  '"': ' inch ',
  "'": '',
  '’': '',
};

/**
 * Words with no search value that only consume the slug's character budget.
 * Kept deliberately small: over-aggressive stopword removal makes slugs
 * unreadable and can strip a genuine part-name token ("in-tank pump").
 */
const SLUG_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'with', 'and', 'to', 'in', 'on', 'by',
  // Marketplace listing noise that appears in scraped titles.
  'new', 'genuine', 'oem', 'original', 'quality', 'high', 'free', 'shipping',
  'sale', 'hot', 'best', 'top', 'pcs', 'pc', 'set', 'kit', 'x1', 'x2',
]);

/**
 * Convert arbitrary text to a URL-safe, lowercase, hyphen-separated token.
 * Handles unicode, punctuation, repeated and edge separators.
 */
export function slugify(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';

  const transliterated = Array.from(raw)
    .map((char) => TRANSLITERATIONS[char] ?? char)
    .join('');

  return transliterated
    // NFKD splits "é" into "e" + combining acute, which the next step drops.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Everything that is not an unaccented latin letter or digit is a break.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Slugify while keeping the result inside a character budget, cutting at a
 * hyphen so a slug never ends mid-word.
 */
export function slugifyBounded(value: unknown, max: number): string {
  const full = slugify(value);
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  const atBoundary = cut.replace(/-[^-]*$/, '');
  return (atBoundary || cut).replace(/^-+|-+$/g, '');
}

/**
 * A short, stable disambiguator derived from the part id. Six base-36
 * characters over a UUID give ~2 billion values, so a second collision on the
 * *same* base slug is not a practical concern; `resolveUniqueSlug` still
 * handles it rather than assuming.
 */
export function stableSuffix(id: string, length = 6): string {
  const source = text(id);
  if (!source) return '';
  // FNV-1a: tiny, dependency-free, and stable across Node versions and
  // platforms — a requirement, since the API and a CLI backfill must agree.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Mix in a second pass over the reversed string so ids sharing a prefix
  // (sequential UUID v7, for example) do not cluster.
  let hash2 = 0x811c9dc5;
  for (let i = source.length - 1; i >= 0; i--) {
    hash2 ^= source.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193) >>> 0;
  }
  const combined = `${hash.toString(36)}${hash2.toString(36)}`;
  return combined.slice(0, length).padEnd(length, '0');
}

/** Drop low-value words, but never return an empty token list. */
function pruneStopwords(slug: string): string {
  if (!slug) return '';
  const tokens = slug.split('-').filter(Boolean);
  const kept = tokens.filter((token) => !SLUG_STOPWORDS.has(token));
  return (kept.length ? kept : tokens).join('-');
}

/** Collapse immediately repeated tokens: "toyota-toyota-camry" → "toyota-camry". */
function dedupeAdjacent(slug: string): string {
  const tokens = slug.split('-').filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (out[out.length - 1] !== token) out.push(token);
  }
  return out.join('-');
}

/**
 * Remove any token that already appears earlier in the slug. Scraped titles
 * routinely repeat the brand and the part number, and a slug that says
 * "bosch-bosch-brake-pad-brake-0986494104" wastes its whole budget.
 */
function dedupeAll(slug: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of slug.split('-').filter(Boolean)) {
    // Numeric tokens may legitimately repeat inside a compound part number.
    if (!/^\d+$/.test(token) && seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out.join('-');
}

export interface PartSlugParts {
  brand: string;
  vehicle: string;
  name: string;
  number: string;
}

/**
 * Pick the strongest identifying number available. MPN first (it is what a
 * buyer searches), then the genuine-OEM number, then the first OE number.
 */
export function primaryPartNumber(part: SeoPartInput): string {
  return (
    text(part.manufacturerPartNumber) ||
    text(part.genuineOemPartNumber) ||
    text((part.oeNumbers || []).find((value) => text(value))) ||
    ''
  );
}

/**
 * The single vehicle worth putting in a URL: only used when the part fits
 * exactly one make (and optionally one model). A part fitting nine makes gets
 * no vehicle token — naming one would be arbitrary and misleading.
 */
export function dominantVehicle(part: SeoPartInput): {
  make: string;
  model: string;
} {
  const vehicles = part.compatibleVehicles || [];
  const makes = uniqueStrings(vehicles.map((vehicle) => vehicle?.make));
  if (makes.length !== 1) return { make: '', model: '' };
  const models = uniqueStrings(
    vehicles
      .filter((vehicle) => text(vehicle?.make).toLowerCase() === makes[0]!.toLowerCase())
      .map((vehicle) => vehicle?.model),
  );
  return { make: makes[0]!, model: models.length === 1 ? models[0]! : '' };
}

/**
 * Decompose a part into the four slug components, in descending keyword
 * value. Each is independently optional — a listing with only a title still
 * produces a usable slug, which is the whole point of the fallback chain.
 */
export function partSlugParts(part: SeoPartInput): PartSlugParts {
  // `rawBrand` still drives redundancy-stripping from the title (removing a
  // "Genuine OEM" prefix there is desirable); only `brand` reaches the URL.
  const rawBrand = text(part.brand) || text(part.manufacturer);
  const brand = meaningfulBrand(rawBrand);
  const { make, model } = dominantVehicle(part);
  const number = primaryPartNumber(part);

  // Strip the brand, vehicle, and number out of the title before slugifying
  // it, so the same words are not spent twice in one URL.
  let name = text(part.title);
  for (const redundant of [rawBrand, make, model]) {
    if (redundant) name = removeRedundant(name, redundant);
  }
  if (number) {
    // Match the number in any separator form, since titles write it freely.
    const normalizedNumber = normalizeIdentifier(number);
    name = name
      .split(/\s+/)
      .filter((token) => normalizeIdentifier(token) !== normalizedNumber)
      .join(' ');
  }
  // A title that was *only* brand + number leaves nothing; fall back to the
  // category so the slug still describes what the thing is.
  if (!slugify(name)) name = text(part.category) || text(part.title);

  return {
    brand: slugify(brand),
    vehicle: slugify([make, model].filter(Boolean).join(' ')),
    name: pruneStopwords(slugify(name)),
    number: slugify(number),
  };
}

/**
 * Build the (not yet uniqueness-checked) slug for a part.
 *
 * Order is brand → vehicle → part name → number, because that is the order a
 * buyer reads and searches, and because it degrades gracefully: dropping the
 * tail still leaves a meaningful URL. The number is never truncated away — it
 * is appended after the length budget is applied to the descriptive portion,
 * since an exact part number is the highest-intent token in the whole slug.
 */
export function buildPartSlugBase(part: SeoPartInput): string {
  const { limits } = seoConfig();
  const parts = partSlugParts(part);

  const numberSuffix = parts.number ? `-${parts.number}` : '';
  const descriptiveBudget = Math.max(
    16,
    limits.slug - numberSuffix.length,
  );

  const descriptive = dedupeAll(
    dedupeAdjacent(
      [parts.brand, parts.vehicle, parts.name].filter(Boolean).join('-'),
    ),
  );

  const bounded = slugifyBounded(
    descriptive.replace(/-/g, ' '),
    descriptiveBudget,
  );

  const combined = dedupeAdjacent(`${bounded}${numberSuffix}`.replace(/^-+/, ''));
  // Absolute last resort: a listing with no usable text at all still needs a
  // routable, non-empty slug. `part` + the stable suffix is added by the
  // uniqueness step, so returning 'part' here is safe and never bare.
  return combined || 'part';
}

/**
 * Resolve a base slug to a unique one.
 *
 * `isTaken(candidate)` must return true when the slug belongs to a *different*
 * entity. Callers own that check because only they know the storage — the API
 * queries Postgres, tests use a Set.
 */
export async function resolveUniqueSlug(
  base: string,
  id: string,
  isTaken: (candidate: string) => boolean | Promise<boolean>,
): Promise<string> {
  const normalized = slugify(base) || 'part';
  if (!(await isTaken(normalized))) return normalized;

  const suffixed = `${normalized}-${stableSuffix(id)}`;
  if (!(await isTaken(suffixed))) return suffixed;

  // Only reached if two different ids hash identically *and* share a base.
  for (let attempt = 2; attempt <= 50; attempt++) {
    const candidate = `${suffixed}-${attempt}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Guaranteed-unique fallback; ugly, but a URL that exists beats a 500.
  return `${normalized}-${slugify(id)}`;
}

/** Taxonomy slugs are plain, stable slugifications of the catalog value. */
export function taxonomySlug(name: unknown): string {
  return slugifyBounded(name, seoConfig().limits.slug);
}

/**
 * Taxonomy URLs are looked up by slug, so the reverse mapping must be exact.
 * Rather than storing a slug per facet value (facets are computed, not rows),
 * a resolver matches an incoming slug against the live facet list. This helper
 * is the comparison key both sides use.
 */
export function taxonomySlugKey(name: unknown): string {
  return taxonomySlug(name);
}

/** Path segment for a taxonomy kind, so URL patterns live in one place. */
export const TAXONOMY_PATH_SEGMENT: Record<SeoTaxonomyKind, string> = {
  category: 'parts/category',
  categoryGroup: 'parts/system',
  brand: 'brands',
  make: 'vehicles',
  model: 'vehicles',
  modelYear: 'vehicles',
};

/**
 * Validate a slug against the rules the URL architecture promises: lowercase,
 * hyphen-separated, no leading/trailing/repeated separators, no encoded
 * characters. Used by the SEO health report to catch anything a manual
 * override introduced.
 */
export function isValidSlug(value: unknown): boolean {
  const candidate = text(value);
  if (!candidate) return false;
  if (candidate.length > seoConfig().limits.slug + 16) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate);
}

/** Slug-shaped strings that must never become a part slug (route collisions). */
export const RESERVED_SLUGS = new Set([
  'category', 'system', 'brand', 'brands', 'vehicle', 'vehicles', 'search',
  'sitemap', 'sitemaps', 'robots', 'api', 'cart', 'checkout', 'account',
  'login', 'signup', 'support', 'contact', 'garage', 'watchlist', 'new',
  'page', 'parts', 'part',
]);

export function isReservedSlug(value: unknown): boolean {
  return RESERVED_SLUGS.has(text(value).toLowerCase());
}

/** Clip a caller-supplied override slug into the same shape as a generated one. */
export function sanitizeOverrideSlug(value: unknown): string {
  const slug = slugifyBounded(value, seoConfig().limits.slug);
  if (!slug || isReservedSlug(slug)) return '';
  return clipHard(slug, seoConfig().limits.slug + 16);
}
