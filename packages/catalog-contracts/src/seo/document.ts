/**
 * The façade: one call in, one render-ready SEO document out.
 *
 * Page components call `buildPartSeoDocument` / `buildTaxonomySeoDocument` and
 * nothing else. That is what keeps SEO out of the pages: a new template, a new
 * app, or a new entry path for listings inherits the entire system by calling
 * one function, and cannot forget a canonical, a robots directive, or a
 * breadcrumb because it does not assemble them.
 */

import { breadcrumbJsonLd, partBreadcrumbs, taxonomyBreadcrumbs } from './breadcrumbs';
import { seoConfig } from './config';
import { partImages, socialImage, taxonomySocialImage } from './image';
import {
  decidePartIndexability,
  decideTaxonomyIndexability,
} from './indexability';
import { partInternalLinks } from './internal-links';
import {
  partDescription,
  partH1,
  partTitle,
  taxonomyDescription,
  taxonomyH1,
  taxonomyTitle,
  withSiteName,
} from './metadata';
import {
  collectionPageJsonLd,
  graph,
  itemListJsonLd,
  productJsonLd,
} from './schema';
import { text } from './text';
import { absoluteUrl, partPath, taxonomyPath } from './url';
import type {
  SeoDocument,
  SeoPartInput,
  SeoTaxonomyInput,
} from './types';

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Record which fields an admin override supplied, for the health report. */
function overriddenFields(overrides: SeoPartInput['seo']): string[] {
  if (!overrides) return [];
  return Object.entries(overrides)
    .filter(([key, value]) => key !== 'note' && text(value) !== '')
    .map(([key]) => key);
}

export interface PartSeoOptions {
  /**
   * Products a taxonomy/related module already resolved. Optional: the
   * document is complete without them, they only enrich `internalLinks`.
   */
  relatedLinks?: SeoDocument['internalLinks'];
}

/**
 * Build the complete SEO document for a product detail page.
 *
 * Requires `part.slug` to be set. A part without a slug has no canonical URL,
 * which is a data-integrity failure rather than something to paper over — the
 * caller should have run slug assignment first, and the health report flags
 * any part in that state.
 */
export function buildPartSeoDocument(
  part: SeoPartInput,
  options: PartSeoOptions = {},
): SeoDocument {
  const config = seoConfig();
  const slug = text(part.slug);
  const path = slug ? partPath(slug) : `/part/${part.id}`;

  // An explicit canonical override exists for the rare case where a listing
  // is a genuine duplicate of another and should consolidate into it.
  const canonical = text(part.seo?.canonicalUrl) || absoluteUrl(path);

  const titleCore = partTitle(part);
  const description = partDescription(part);
  const h1 = partH1(part);
  const images = partImages(part);
  const decision = decidePartIndexability(part);
  const social = socialImage(part, images, absoluteUrl);
  const breadcrumbs = partBreadcrumbs(part);

  const structuredData = graph([
    breadcrumbJsonLd(breadcrumbs),
    productJsonLd(part, {
      canonical,
      name: titleCore,
      description,
      images,
    }),
  ]);

  const lastModified =
    toIsoString(part.contentUpdatedAt) ||
    toIsoString(part.updatedAt) ||
    toIsoString(part.createdAt);

  return {
    canonical,
    path,
    title: withSiteName(titleCore),
    titleCore,
    description,
    h1,
    robots: decision.robots,
    indexabilityReasons: decision.reasons,
    // A part with no slug cannot be in a sitemap even if it is otherwise
    // indexable — the URL it would advertise is the legacy one.
    sitemapEligible: decision.sitemapEligible && Boolean(slug),
    ...(lastModified ? { lastModified } : {}),
    breadcrumbs,
    images,
    ...(images[0] ? { primaryImage: images[0] } : {}),
    openGraph: {
      title: titleCore,
      description,
      url: canonical,
      siteName: config.siteName,
      type: 'website',
      images: [social],
      locale: config.locale,
    },
    twitter: {
      card: images.length ? 'summary_large_image' : config.twitterCard,
      title: titleCore,
      description,
      images: [social.url],
    },
    structuredData,
    internalLinks: [...partInternalLinks(part), ...(options.relatedLinks || [])],
    overridden: overriddenFields(part.seo),
  };
}

export interface TaxonomySeoOptions {
  /** The listings rendered on this page, for `ItemList` markup. */
  items?: Array<{ url: string; name: string }>;
  /** Child taxonomy nodes to link to, already filtered for eligibility. */
  childLinks?: SeoDocument['internalLinks'];
}

/**
 * Build the complete SEO document for a taxonomy landing page.
 *
 * The canonical always points at page 1 of the node for paginated views'
 * *content identity*, except that each paginated page self-canonicalises —
 * Google's guidance since rel=prev/next was retired. So: page N canonicalises
 * to page N, and pages beyond 1 carry `noindex, follow`, which keeps deep
 * inventory crawlable without filling the index with grid pages.
 */
export function buildTaxonomySeoDocument(
  node: SeoTaxonomyInput,
  options: TaxonomySeoOptions = {},
): SeoDocument {
  const config = seoConfig();
  const path = taxonomyPath(node);
  const canonical = text(node.seo?.canonicalUrl) || absoluteUrl(path);

  const titleCore = taxonomyTitle(node);
  const description = taxonomyDescription(node);
  const h1 = taxonomyH1(node);
  const decision = decideTaxonomyIndexability(node);
  const breadcrumbs = taxonomyBreadcrumbs(node);
  const social = taxonomySocialImage(node, absoluteUrl);

  const page = node.page ?? 1;
  const pageSizeGuess = options.items?.length ?? 0;

  const structuredData = graph([
    breadcrumbJsonLd(breadcrumbs),
    collectionPageJsonLd(node, { canonical, name: titleCore, description }),
    options.items?.length
      ? itemListJsonLd(options.items, {
          canonical,
          startPosition: (page - 1) * pageSizeGuess + 1,
        })
      : null,
  ]);

  const lastModified = toIsoString(node.updatedAt);

  return {
    canonical,
    path,
    title: withSiteName(titleCore),
    titleCore,
    description,
    h1,
    robots: decision.robots,
    indexabilityReasons: decision.reasons,
    sitemapEligible: decision.sitemapEligible,
    ...(lastModified ? { lastModified } : {}),
    breadcrumbs,
    images: [],
    openGraph: {
      title: titleCore,
      description,
      url: canonical,
      siteName: config.siteName,
      type: 'website',
      images: [social],
      locale: config.locale,
    },
    twitter: {
      card: config.twitterCard,
      title: titleCore,
      description,
      images: [social.url],
    },
    structuredData,
    internalLinks: options.childLinks || [],
    overridden: overriddenFields(node.seo),
  };
}
