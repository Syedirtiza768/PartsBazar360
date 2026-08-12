/**
 * The data contracts the SEO engine consumes.
 *
 * These are deliberately structural and permissive rather than Prisma types:
 * the same generators run against a Prisma row in the API, a search-index
 * document in a sitemap job, and a serialised API response in the Next.js
 * server. All three shapes satisfy `SeoPartInput`, so one implementation
 * covers every entry path a listing can take into the system (form, CSV,
 * eBay sync, ERP push, bulk SQL insert).
 */

export interface SeoVehicleRef {
  make?: string | null;
  model?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  /** Free-form label such as "2010-2015 Audi Q7", used when parts are absent. */
  label?: string | null;
}

export interface SeoOfferInput {
  price?: number | string | null;
  currency?: string | null;
  condition?: string | null;
  partSource?: string | null;
  qualityTier?: string | null;
  inStock?: boolean | null;
  quantity?: number | null;
  sellerName?: string | null;
  sellerId?: string | null;
  /** Shipping cost, when the seller publishes a fixed rate. */
  shippingPrice?: number | string | null;
  shippingCurrency?: string | null;
  /** ISO-3166 alpha-2 the offer ships from, for merchant-listing schema. */
  shipsFromCountry?: string | null;
}

export interface SeoMediaInput {
  url?: string | null;
  altText?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Admin-authored overrides. Every field is optional; a present, non-empty
 * value always wins over the generated one (fallback hierarchy step 1).
 * Stored as a JSON column so adding a new overridable field needs no
 * migration.
 */
export interface SeoOverrides {
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  slug?: string | null;
  canonicalUrl?: string | null;
  /** Force-index or force-noindex, overriding the decision engine. */
  robots?: 'index' | 'noindex' | null;
  ogImageUrl?: string | null;
  breadcrumbLabel?: string | null;
  /** Free-form note explaining why an override exists, for the audit trail. */
  note?: string | null;
}

export interface SeoPartInput {
  id: string;
  /** Persisted slug. Absent means "not yet generated" — never means "derive it". */
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  partType?: string | null;
  partSource?: string | null;
  qualityTier?: string | null;
  position?: string | null;
  vehicleSystem?: string | null;
  material?: string | null;
  manufacturerPartNumber?: string | null;
  genuineOemPartNumber?: string | null;
  oeNumbers?: Array<string | null> | null;
  imageUrls?: Array<string | null> | null;
  media?: SeoMediaInput[] | null;
  offers?: SeoOfferInput[] | null;
  compatibleVehicles?: SeoVehicleRef[] | null;
  itemSpecifics?: Record<string, unknown> | null;
  /** Admin overrides, read from the `seo` JSON column. */
  seo?: SeoOverrides | null;
  /** Lifecycle state; drives availability schema and index eligibility. */
  status?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  /** Timestamp of the last change that affects rendered content, if tracked. */
  contentUpdatedAt?: Date | string | null;
}

export type SeoTaxonomyKind =
  | 'category'
  | 'categoryGroup'
  | 'brand'
  | 'make'
  | 'model'
  | 'modelYear';

export interface SeoTaxonomyInput {
  kind: SeoTaxonomyKind;
  /** Raw catalog value, e.g. "Brake Pads" or "Toyota". */
  name: string;
  /** Number of *indexable* listings in this node. Drives eligibility. */
  productCount: number;
  /** Parent chain, outermost first, for breadcrumbs and nested URLs. */
  parents?: Array<{ kind: SeoTaxonomyKind; name: string }>;
  /** Only set for `modelYear`. */
  year?: number | null;
  /** Sample of child taxonomy nodes, used for on-page internal linking. */
  children?: Array<{ kind: SeoTaxonomyKind; name: string; productCount: number }>;
  seo?: SeoOverrides | null;
  updatedAt?: Date | string | null;
  /** 1-based page number for paginated collection pages. */
  page?: number;
  totalPages?: number;
}

export interface SeoRobots {
  index: boolean;
  follow: boolean;
}

export interface SeoBreadcrumb {
  name: string;
  /** Absolute URL. The last crumb points at the page itself. */
  url: string;
  /** Relative path, for in-app `<Link>` navigation. */
  path: string;
}

export interface SeoImage {
  url: string;
  alt: string;
  isPrimary: boolean;
  width?: number;
  height?: number;
}

export interface SeoInternalLink {
  label: string;
  path: string;
  /** Why this link exists — used by tests and the health report, not rendered. */
  relation:
    | 'category'
    | 'categoryGroup'
    | 'brand'
    | 'make'
    | 'model'
    | 'partNumber'
    | 'seller'
    | 'related';
}

/** The complete, render-ready SEO description of one page. */
export interface SeoDocument {
  /** Absolute canonical URL. Always exactly one per page. */
  canonical: string;
  /** Canonical path relative to the site root (no origin, no basePath). */
  path: string;
  /** Rendered `<title>`, brand suffix included. */
  title: string;
  /** Title without the brand suffix — for OG/Twitter, which repeat siteName. */
  titleCore: string;
  description: string;
  h1: string;
  robots: SeoRobots;
  /** Human-readable reasons the page is not indexable. Empty when it is. */
  indexabilityReasons: string[];
  /** True when this URL belongs in an XML sitemap. */
  sitemapEligible: boolean;
  lastModified?: string;
  breadcrumbs: SeoBreadcrumb[];
  images: SeoImage[];
  primaryImage?: SeoImage;
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    type: 'website' | 'article';
    images: Array<{ url: string; alt: string; width?: number; height?: number }>;
    locale: string;
  };
  twitter: {
    card: 'summary' | 'summary_large_image';
    title: string;
    description: string;
    images: string[];
  };
  /** JSON-LD `@graph`, ready to serialise into a single script tag. */
  structuredData: Record<string, unknown>;
  internalLinks: SeoInternalLink[];
  /** Which values came from an admin override rather than generation. */
  overridden: string[];
}
