/**
 * The index / noindex decision engine.
 *
 * No page component decides its own robots directive. Every indexable entity
 * runs through one of these functions, which return both the decision and the
 * human-readable reasons behind it — the reasons are what make the SEO health
 * report actionable ("42 listings noindex: no verified image") instead of a
 * bare count.
 *
 * The bias is deliberate: a page that cannot demonstrate unique value to a
 * buyer gets `noindex, follow`. `follow` rather than `none`, because such a
 * page still passes crawl equity to the listings it links to; suppressing the
 * page must not orphan its children.
 */

import { isCatalogHidden } from '../catalog-visibility';
import { seoConfig } from './config';
import { stripHtml, text, uniqueStrings } from './text';
import type { SeoPartInput, SeoRobots, SeoTaxonomyInput } from './types';

export interface IndexDecision {
  robots: SeoRobots;
  /** Empty when indexable. Each entry is a reason it is not. */
  reasons: string[];
  /** Sitemaps carry only indexable, canonical, 200-returning URLs. */
  sitemapEligible: boolean;
}

const INDEXABLE: SeoRobots = { index: true, follow: true };
const NOINDEX_FOLLOW: SeoRobots = { index: false, follow: true };

/** Part lifecycle states that must not be indexed while in that state. */
const NON_INDEXABLE_STATUSES = new Set([
  'DRAFT',
  'PENDING',
  'PENDING_REVIEW',
  'REJECTED',
  'SUSPENDED',
  'ARCHIVED',
  'DELETED',
  'HIDDEN',
]);

function decide(reasons: string[], forced?: 'index' | 'noindex' | null): IndexDecision {
  const { indexingEnabled } = seoConfig();

  // A non-production deployment is never indexable, and no override may
  // unlock it — this is what keeps staging out of the index.
  if (!indexingEnabled) {
    return {
      robots: { index: false, follow: false },
      reasons: [...reasons, 'Indexing disabled for this environment'],
      sitemapEligible: false,
    };
  }

  if (forced === 'noindex') {
    return {
      robots: NOINDEX_FOLLOW,
      reasons: [...reasons, 'Admin override: noindex'],
      sitemapEligible: false,
    };
  }

  // An admin force-index clears generated reasons but is still recorded, so
  // the health report can surface pages indexed against the engine's advice.
  if (forced === 'index') {
    return { robots: INDEXABLE, reasons: [], sitemapEligible: true };
  }

  const indexable = reasons.length === 0;
  return {
    robots: indexable ? INDEXABLE : NOINDEX_FOLLOW,
    reasons,
    sitemapEligible: indexable,
  };
}

/** Offers a buyer can actually act on: priced, in stock, not withdrawn. */
export function purchasableOffers(part: SeoPartInput) {
  return (part.offers || []).filter((offer) => {
    const price = Number(offer?.price);
    if (!Number.isFinite(price) || price <= 0) return false;
    if (offer?.inStock === false) return false;
    if (offer?.quantity !== null && offer?.quantity !== undefined && offer.quantity <= 0) {
      return false;
    }
    return true;
  });
}

/**
 * How much genuinely unique, human-readable content the listing carries.
 * Counted across the description and the structured specifics, because a part
 * with a rich spec table and a terse description is not thin.
 */
export function contentDepth(part: SeoPartInput): number {
  const description = stripHtml(part.description).length;
  const specifics = part.itemSpecifics || {};
  const specificsChars = Object.entries(specifics)
    // `_`-prefixed keys are pipeline bookkeeping, not buyer-facing content.
    .filter(([key]) => !key.startsWith('_'))
    .reduce((total, [, value]) => total + text(value).length, 0);
  const numbers = uniqueStrings(part.oeNumbers || []).join('').length;
  return description + specificsChars + numbers;
}

/**
 * Decide indexability for a product detail page.
 *
 * A listing earns indexing when it is live, buyable, visually verifiable, and
 * identifiable. Anything less is a page that would compete with better pages
 * on the same site for the same query.
 */
export function decidePartIndexability(part: SeoPartInput): IndexDecision {
  const reasons: string[] = [];
  const { thresholds } = seoConfig();

  // A hidden part exists only so a live checkout can be exercised against it.
  // It must never be indexed, and no admin override may unhide it.
  if (isCatalogHidden(part)) {
    return {
      robots: NOINDEX_FOLLOW,
      reasons: ['Hidden from catalog'],
      sitemapEligible: false,
    };
  }

  const status = text(part.status).toUpperCase();
  if (status && NON_INDEXABLE_STATUSES.has(status)) {
    reasons.push(`Listing status is ${status}`);
  }

  const images = uniqueStrings([
    ...(part.imageUrls || []),
    ...(part.media || []).map((media) => media?.url),
  ]);
  if (!images.length) reasons.push('No product image');

  const offers = purchasableOffers(part);
  if (!offers.length) reasons.push('No purchasable offer');

  // Identity: a page needs at least one of the three things a buyer could
  // plausibly search for, otherwise its title is generic and duplicative.
  const hasIdentity =
    Boolean(text(part.manufacturerPartNumber) || text(part.genuineOemPartNumber)) ||
    Boolean(text(part.brand)) ||
    Boolean(text(part.category));
  if (!hasIdentity) reasons.push('Insufficient product identity');

  if (!text(part.title)) reasons.push('No product title');

  if (contentDepth(part) < thresholds.minDescriptionChars) {
    reasons.push('Insufficient unique content');
  }

  // An image that the enrichment pipeline flagged as not-yet-matched is worse
  // than no image: it would publish a picture of a different part.
  const seoEvidence = (part.itemSpecifics?.['_seo'] || null) as
    | Record<string, unknown>
    | null;
  if (seoEvidence && text(seoEvidence['imageAssessment'])) {
    const assessment = text(seoEvidence['imageAssessment']).toUpperCase();
    const confidence = text(seoEvidence['imageConfidence']).toUpperCase();
    const health = text(seoEvidence['imageHealth']).toLowerCase();
    const confirmed =
      assessment === 'MATCH' && confidence === 'HIGH' && health === 'valid';
    if (!confirmed) reasons.push('Product image is awaiting exact-match review');
  }

  return decide(reasons, part.seo?.robots ?? null);
}

/**
 * Decide indexability for a programmatically generated taxonomy page.
 *
 * This is the guard against pSEO explosion. Thresholds scale with how many
 * pages the pattern can produce: one category page per category is fine at
 * eight listings; one page per make × model × year is not, so it needs
 * meaningfully more inventory before it earns a place in the index.
 */
export function decideTaxonomyIndexability(node: SeoTaxonomyInput): IndexDecision {
  const reasons: string[] = [];
  const { thresholds } = seoConfig();

  if (!text(node.name)) reasons.push('Taxonomy node has no name');

  const minimum =
    node.kind === 'modelYear'
      ? thresholds.vehicleYearMinProducts
      : node.kind === 'model'
        ? thresholds.vehicleModelMinProducts
        : thresholds.taxonomyMinProducts;

  if (node.productCount < minimum) {
    reasons.push(
      `Only ${node.productCount} indexable listing${node.productCount === 1 ? '' : 's'} (needs ${minimum})`,
    );
  }

  // Deep pagination is crawlable and self-canonical, but a page-40 listing
  // grid has no standalone search intent, so it stays out of the index.
  const page = node.page ?? 1;
  if (page > 1) reasons.push(`Pagination page ${page}`);

  return decide(reasons, node.seo?.robots ?? null);
}

/**
 * Faceted navigation policy.
 *
 * Users may combine any filters they like; the crawler may not. A single
 * facet with enough depth is a real landing page and is expressed as a
 * taxonomy URL. Everything else — two or more facets, price ranges, sorts,
 * free text, vehicle-config lookups, page-size variants — is a view of an
 * existing page and canonicalises back to it.
 */
export interface FacetState {
  q?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  brand?: string | null;
  make?: string | null;
  model?: string | null;
  partType?: string | null;
  condition?: string | null;
  sourceTag?: string | null;
  minPrice?: string | number | null;
  maxPrice?: string | number | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
  vehicleConfigId?: string | null;
  [key: string]: unknown;
}

/** Facets that, alone, correspond to a real taxonomy landing page. */
const LANDING_FACETS = ['category', 'categoryGroup', 'brand', 'make'] as const;

export interface FacetDecision extends IndexDecision {
  /** Which single facet (if any) this state maps to. */
  landingFacet?: (typeof LANDING_FACETS)[number];
  landingValue?: string;
  /** Number of active content-defining facets. */
  activeFacetCount: number;
}

export function decideFacetIndexability(state: FacetState): FacetDecision {
  const reasons: string[] = [];

  const active = LANDING_FACETS.filter((facet) => text(state[facet]));
  const activeFacetCount = active.length;

  if (text(state.q)) reasons.push('Internal search results are not indexable');
  if (text(state.vehicleConfigId)) {
    reasons.push('Vehicle-configuration lookup is a tool, not a landing page');
  }
  if (text(state.minPrice) || text(state.maxPrice)) {
    reasons.push('Price-filtered view');
  }
  if (text(state.partType)) reasons.push('Secondary facet: partType');
  if (text(state.condition)) reasons.push('Secondary facet: condition');
  if (text(state.sourceTag)) reasons.push('Secondary facet: sourceTag');
  if (text(state.pageSize)) reasons.push('Page-size variant');

  const sort = text(state.sort).toLowerCase();
  // `relevance` and `newest` are the two canonical orderings; a price sort is
  // a re-ordering of the same set and must not be a second indexable URL.
  if (sort && sort !== 'relevance' && sort !== 'newest') {
    reasons.push(`Non-canonical sort: ${sort}`);
  }

  const page = Number(state.page || 1);
  if (Number.isFinite(page) && page > 1) reasons.push(`Pagination page ${page}`);

  if (activeFacetCount > 1) {
    reasons.push(`Multi-facet combination (${active.join(' + ')})`);
  }

  const decision = decide(reasons);
  const landingFacet = activeFacetCount === 1 ? active[0] : undefined;

  return {
    ...decision,
    // Search-result URLs never belong in a sitemap even when indexable —
    // their taxonomy equivalents carry that job.
    sitemapEligible: false,
    ...(landingFacet ? { landingFacet, landingValue: text(state[landingFacet]) } : {}),
    activeFacetCount,
  };
}

/**
 * Availability for schema.org and for out-of-stock handling.
 *
 * A part that is temporarily unavailable keeps its URL and its index status —
 * removing a ranked page because stock ran out throws away the ranking. It
 * simply declares `OutOfStock`, which is exactly what the vocabulary is for.
 */
export function availabilityFor(part: SeoPartInput): string {
  const status = text(part.status).toUpperCase();
  if (status === 'SOLD' || status === 'SOLD_OUT') return 'https://schema.org/SoldOut';
  if (status === 'DISCONTINUED') return 'https://schema.org/Discontinued';
  return purchasableOffers(part).length
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
}
