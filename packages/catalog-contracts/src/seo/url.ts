/**
 * URL and canonical generation.
 *
 * Every public URL in the storefront is produced here. Page components never
 * concatenate paths, so the "one authoritative URL per page" rule is enforced
 * structurally rather than by convention: there is only one function that can
 * emit a canonical, and it always normalises case, trailing slash, tracking
 * parameters, and parameter order.
 */

import { seoConfig } from './config';
import { taxonomySlug } from './slug';
import { text } from './text';
import type { SeoTaxonomyInput, SeoTaxonomyKind } from './types';

/** Normalise a path fragment to a leading-slash, no-trailing-slash form. */
function normalizePath(path: string): string {
  const trimmed = text(path);
  if (!trimmed || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '') || '/';
}

/**
 * Absolute URL for an in-app path.
 *
 * `next.config.js` sets `trailingSlash: true`, so the server 308s a
 * slash-less URL to the slash form. A canonical must point at the destination
 * of that redirect, not its source — otherwise every canonical on the site
 * advertises a URL that immediately redirects.
 */
export function absoluteUrl(path = '/', params?: Record<string, unknown>): string {
  const { siteUrl } = seoConfig();
  const normalized = normalizePath(path);
  const query = buildQueryString(params);
  return `${siteUrl}${withTrailingSlash(normalized)}${query}`;
}

/**
 * Add the trailing slash `trailingSlash: true` expects — except on paths whose
 * last segment looks like a file (`/sitemap.xml`, `/robots.txt`). Next excludes
 * those from its own slash normalisation, so appending one here would advertise
 * a URL that does not exist.
 */
function withTrailingSlash(normalized: string): string {
  if (normalized === '/') return '/';
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) return normalized;
  return `${normalized}/`;
}

/**
 * Deterministic query string: tracking parameters removed, empty values
 * dropped, keys sorted. Sorting matters — `?a=1&b=2` and `?b=2&a=1` are the
 * same page, and without a canonical order they would advertise two.
 */
export function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return '';
  const { trackingParams } = seoConfig();
  const tracking = new Set(trackingParams);
  const entries = Object.entries(params)
    .filter(([key, value]) => !tracking.has(key) && text(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return '';
  const search = new URLSearchParams();
  for (const [key, value] of entries) search.set(key, text(value));
  return `?${search.toString()}`;
}

/**
 * Strip everything that does not change page identity from a caller-supplied
 * query object. Used by canonical generators on filterable pages.
 */
export function canonicalParams(
  params: Record<string, unknown> | undefined,
  keep: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  for (const key of keep) {
    const value = text(params[key]);
    if (value) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entity URL patterns. These four functions define the whole URL architecture.
// ---------------------------------------------------------------------------

/** Canonical product path. Slug-only — no id, no UUID, no query. */
export function partPath(slug: string): string {
  return `/parts/${text(slug)}`;
}

export function partUrl(slug: string): string {
  return absoluteUrl(partPath(slug));
}

/**
 * The legacy UUID product path. Retained solely so the redirect layer and the
 * validator can name it; nothing generates links to it any more.
 */
export function legacyPartPath(id: string): string {
  return `/part/${text(id)}`;
}

export function categoryPath(name: unknown, page?: number): string {
  const base = `/parts/category/${taxonomySlug(name)}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

export function categoryGroupPath(name: unknown, page?: number): string {
  const base = `/parts/system/${taxonomySlug(name)}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

export function brandPath(name: unknown, page?: number): string {
  const base = `/brands/${taxonomySlug(name)}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

export function makePath(make: unknown, page?: number): string {
  const base = `/vehicles/${taxonomySlug(make)}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

export function modelPath(make: unknown, model: unknown, page?: number): string {
  const base = `/vehicles/${taxonomySlug(make)}/${taxonomySlug(model)}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

export function modelYearPath(
  make: unknown,
  model: unknown,
  year: number | null | undefined,
  page?: number,
): string {
  if (!year) return modelPath(make, model, page);
  const base = `/vehicles/${taxonomySlug(make)}/${taxonomySlug(model)}/${year}`;
  return page && page > 1 ? `${base}/page/${page}` : base;
}

/**
 * Path for any taxonomy node. Parent context comes from `parents`, which is
 * how a model page knows its make without the caller threading it through.
 */
export function taxonomyPath(node: SeoTaxonomyInput): string {
  const parentOf = (kind: SeoTaxonomyKind): string =>
    text((node.parents || []).find((parent) => parent.kind === kind)?.name);

  switch (node.kind) {
    case 'category':
      return categoryPath(node.name, node.page);
    case 'categoryGroup':
      return categoryGroupPath(node.name, node.page);
    case 'brand':
      return brandPath(node.name, node.page);
    case 'make':
      return makePath(node.name, node.page);
    case 'model':
      return modelPath(parentOf('make'), node.name, node.page);
    case 'modelYear':
      return modelYearPath(
        parentOf('make'),
        parentOf('model'),
        node.year,
        node.page,
      );
    default:
      return '/search';
  }
}

export function taxonomyUrl(node: SeoTaxonomyInput): string {
  return absoluteUrl(taxonomyPath(node));
}

/**
 * The buyer-facing search/browse path. Search remains a *tool*, not an SEO
 * surface: it keeps query parameters and is never canonicalised into a
 * taxonomy page's identity. Taxonomy pages own the indexable equivalents.
 */
export function searchPath(params?: Record<string, unknown>): string {
  return `/search${buildQueryString(params)}`;
}

/**
 * Normalise an arbitrary inbound URL to its canonical form: lowercase host,
 * https, no `www.`, no tracking parameters, sorted query, trailing slash.
 * Used by the redirect layer and by the health report to detect duplicates.
 */
export function normalizeInboundUrl(input: string): string | null {
  const raw = text(input);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const { trackingParams } = seoConfig();
  for (const param of trackingParams) parsed.searchParams.delete(param);

  const sorted = new URLSearchParams();
  for (const [key, value] of [...parsed.searchParams.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (text(value)) sorted.set(key, value);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const withSlash = pathname === '/' ? '/' : `${pathname}/`;
  const query = sorted.toString();
  return `https://${host}${withSlash}${query ? `?${query}` : ''}`;
}

/**
 * True when two URLs address the same page. Used to assert that a redirect
 * target is not also a redirect source (no chains) and that a canonical does
 * not point at itself through a different spelling.
 */
export function sameUrl(a: string, b: string): boolean {
  const normalizedA = normalizeInboundUrl(a);
  const normalizedB = normalizeInboundUrl(b);
  return Boolean(normalizedA && normalizedB && normalizedA === normalizedB);
}
