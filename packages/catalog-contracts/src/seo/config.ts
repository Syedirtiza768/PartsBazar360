/**
 * Central SEO configuration — the one place global SEO rules live.
 *
 * Nothing else in the codebase should hardcode a site name, a title template,
 * a metadata length limit, an index-eligibility threshold, or a URL pattern.
 * Everything downstream (metadata, canonicals, schema, sitemaps, robots,
 * taxonomy pages, validation) reads from here, so a policy change is a change
 * to this file rather than a sweep through page components.
 *
 * Values are env-overridable because the same engine runs in the API process,
 * the buyer Next.js server, and CLI backfills, which do not share a runtime.
 */

function envString(key: string, fallback: string): string {
  // Bracket access avoids Next's build-time const-folding of `process.env.X`,
  // which previously baked localhost into production robots.txt.
  const raw = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const value = String(raw ?? '').trim();
  return value || fallback;
}

function envInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(envString(key, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Production origin *including* the `/buyer` basePath. The storefront is
 * served under a path prefix by nginx, so every canonical, sitemap entry, and
 * JSON-LD url must carry it — a canonical without `/buyer` 302s and splits
 * signals across two URLs.
 */
const DEFAULT_PRODUCTION_SITE_URL = 'https://partsbazar360.com/buyer';
const DEFAULT_DEV_SITE_URL = 'http://localhost:7070/buyer';

export interface SeoLimits {
  /** Max rendered `<title>` length *excluding* the brand suffix. */
  titleCore: number;
  /** Max `<title>` length including the brand suffix. */
  title: number;
  /** Max meta description length. */
  description: number;
  /** Max H1 length. */
  h1: number;
  /** Max image ALT length — long ALT reads as keyword stuffing. */
  alt: number;
  /** Max slug length, before the uniqueness suffix. */
  slug: number;
  /** Max URLs per sitemap file. Sitemaps protocol caps at 50 000. */
  sitemapPageSize: number;
}

export interface SeoThresholds {
  /**
   * Minimum indexable listings a taxonomy page needs before it may be
   * indexed. Below this the page stays reachable and crawlable but carries
   * `noindex, follow` and is excluded from sitemaps — the guard against
   * programmatic thin-page explosion.
   */
  taxonomyMinProducts: number;
  /** Vehicle make+model pages are more numerous, so they need more depth. */
  vehicleModelMinProducts: number;
  /** make + model + year is the thinnest combination we will ever index. */
  vehicleYearMinProducts: number;
  /** Two-facet combinations (brand × category) need real depth to earn a page. */
  facetCombinationMinProducts: number;
  /** A part with fewer characters of real description is treated as thin. */
  minDescriptionChars: number;
}

export interface SeoConfigShape {
  siteName: string;
  /** Legal/organisation name used in Organization JSON-LD. */
  organizationName: string;
  siteUrl: string;
  /** Origin without the basePath — used for robots and cross-app links. */
  origin: string;
  basePath: string;
  locale: string;
  defaultCurrency: string;
  /** Separator between the page-specific title and the brand suffix. */
  titleSeparator: string;
  /** Fallback OG image path, relative to `siteUrl`. */
  fallbackOgImage: string;
  twitterCard: 'summary' | 'summary_large_image';
  limits: SeoLimits;
  thresholds: SeoThresholds;
  /**
   * Query parameters that never change the content identity of a page. They
   * are stripped from canonicals so tracking links do not create duplicates.
   */
  trackingParams: readonly string[];
  /**
   * Path prefixes that must never be indexed regardless of what any page-level
   * generator says. Mirrored into robots.txt.
   */
  privatePathPrefixes: readonly string[];
  /** True when this deployment may be indexed at all (production only). */
  indexingEnabled: boolean;
}

/** Resolved at call time, never at module load — env arrives late in Next. */
export function seoConfig(): SeoConfigShape {
  const isProduction = envString('NODE_ENV', 'development') === 'production';
  const siteUrl = envString(
    'SITE_URL',
    isProduction ? DEFAULT_PRODUCTION_SITE_URL : DEFAULT_DEV_SITE_URL,
  ).replace(/\/+$/, '');

  // Derive origin/basePath from siteUrl so a single env var configures both.
  let origin = siteUrl;
  let basePath = '';
  try {
    const parsed = new URL(siteUrl);
    origin = parsed.origin;
    basePath = parsed.pathname.replace(/\/+$/, '');
  } catch {
    /* keep the raw string; malformed SITE_URL is caught by seo validation */
  }

  // A non-production deployment must never be indexable — this is the single
  // switch that keeps staging out of the index without per-page changes.
  const indexingEnabled =
    envString('SEO_INDEXING_ENABLED', isProduction ? '1' : '0') !== '0';

  return {
    siteName: envString('SEO_SITE_NAME', 'PartsBazar360'),
    organizationName: envString('SEO_ORGANIZATION_NAME', 'PartsBazar360'),
    siteUrl,
    origin,
    basePath,
    locale: envString('SEO_LOCALE', 'en'),
    defaultCurrency: envString('SEO_DEFAULT_CURRENCY', 'AED'),
    titleSeparator: ' | ',
    fallbackOgImage: '/og.png',
    twitterCard: 'summary_large_image',
    limits: {
      titleCore: envInt('SEO_LIMIT_TITLE_CORE', 60),
      title: envInt('SEO_LIMIT_TITLE', 70),
      description: envInt('SEO_LIMIT_DESCRIPTION', 158),
      h1: envInt('SEO_LIMIT_H1', 110),
      alt: envInt('SEO_LIMIT_ALT', 125),
      slug: envInt('SEO_LIMIT_SLUG', 80),
      sitemapPageSize: envInt('SEO_SITEMAP_PAGE_SIZE', 5_000),
    },
    thresholds: {
      taxonomyMinProducts: envInt('SEO_MIN_TAXONOMY_PRODUCTS', 8),
      vehicleModelMinProducts: envInt('SEO_MIN_VEHICLE_MODEL_PRODUCTS', 12),
      vehicleYearMinProducts: envInt('SEO_MIN_VEHICLE_YEAR_PRODUCTS', 25),
      facetCombinationMinProducts: envInt('SEO_MIN_FACET_COMBO_PRODUCTS', 30),
      minDescriptionChars: envInt('SEO_MIN_DESCRIPTION_CHARS', 60),
    },
    trackingParams: [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'gclid',
      'gbraid',
      'wbraid',
      'fbclid',
      'msclkid',
      'ttclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'referrer',
      'source',
      '_gl',
      'yclid',
      'igshid',
    ],
    privatePathPrefixes: [
      '/cart',
      '/checkout',
      '/account',
      '/login',
      '/signup',
      '/forgot-password',
      '/reset-password',
      '/verify-email',
      '/watchlist',
      '/garage',
      '/api/',
    ],
    indexingEnabled,
  };
}

/** Convenience for call sites that only need the resolved origin + basePath. */
export function siteUrl(): string {
  return seoConfig().siteUrl;
}
