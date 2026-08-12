/**
 * Storefront adapter over the shared SEO engine.
 *
 * All generation logic lives in `@repo/catalog-contracts/seo` so the API and
 * the storefront cannot drift. This file only does two things the engine
 * cannot: convert the storefront's `Part` shape into the engine's input
 * contract, and convert an `SeoDocument` into Next's `Metadata` object.
 *
 * The previous hand-rolled helpers (`searchCanonical`, `NOINDEX_ROBOTS`, …)
 * are re-exported so existing pages keep compiling while they migrate.
 */

import type { Metadata } from "next";
import {
  absoluteUrl as engineAbsoluteUrl,
  buildPartSeoDocument,
  buildTaxonomySeoDocument,
  decideFacetIndexability,
  partPath,
  searchPath,
  seoConfig,
  type FacetState,
  type SeoDocument,
  type SeoPartInput,
  type SeoTaxonomyInput,
} from "@repo/catalog-contracts";
import type { Part } from "@/lib/types";

export { absoluteUrl, partPath, searchPath } from "@repo/catalog-contracts";

/** Public storefront origin including the `/buyer` basePath, no trailing slash. */
export function getSiteUrl(): string {
  return seoConfig().siteUrl;
}

/**
 * Canonical href for a part. Falls back to the legacy id URL for a part whose
 * slug has not been assigned yet — that URL 301s to the slug, so a link is
 * never broken, only one hop longer until the backfill reaches it.
 */
export function partHref(part: Pick<Part, "id" | "slug">): string {
  return part.slug ? partPath(part.slug) : `/part/${part.id}`;
}

/**
 * Map the storefront's `Part` to the engine's input contract.
 *
 * `compatibleVehicles` is the API's flattened fitment view; the engine uses it
 * for the vehicle taxonomy, breadcrumbs, and schema, so passing it through is
 * what makes a listing's vehicle pages and fitment markup appear automatically
 * as soon as fitment data lands.
 */
export function toSeoPart(part: Part): SeoPartInput {
  return {
    id: part.id,
    slug: part.slug ?? null,
    title: part.title,
    description: part.description ?? null,
    brand: part.brand ?? null,
    manufacturer: part.manufacturer ?? null,
    category: part.category ?? null,
    categoryGroup: part.categoryGroup ?? null,
    partType: part.partType ?? null,
    partSource: part.partSource ?? null,
    qualityTier: part.qualityTier ?? null,
    position: part.position ?? null,
    vehicleSystem: part.vehicleSystem ?? null,
    material: part.material ?? null,
    manufacturerPartNumber: part.manufacturerPartNumber ?? null,
    oeNumbers: part.oeNumbers ?? [],
    imageUrls: part.imageUrls ?? [],
    media: (part.media ?? []).map((entry) => ({
      url: entry.url,
      altText: entry.altText ?? null,
      isPrimary: entry.isPrimary ?? null,
      sortOrder: entry.sortOrder ?? null,
    })),
    offers: (part.offers ?? []).map((offer) => ({
      price: offer.price,
      currency: offer.currency ?? null,
      condition: offer.condition,
      partSource: offer.partSource ?? null,
      qualityTier: offer.qualityTier ?? null,
      sellerName: offer.seller?.name ?? offer.sellerName ?? null,
      sellerId: offer.sellerId ?? null,
      // An offer row reaching the storefront has already been filtered for
      // stock and seller status by the API, so its presence means buyable.
      inStock: true,
    })),
    compatibleVehicles: (part.compatibleVehicles ?? []).map((vehicle) => ({
      make: vehicle.make,
      model: vehicle.model,
      startYear: vehicle.startYear,
      endYear: vehicle.endYear,
      label: vehicle.label,
    })),
    itemSpecifics: (part.itemSpecifics as Record<string, unknown> | null) ?? null,
    seo: part.seo ?? null,
    createdAt: part.createdAt ?? null,
  };
}

/** Build the full SEO document for a product detail page. */
export function partSeo(part: Part): SeoDocument {
  return buildPartSeoDocument(toSeoPart(part));
}

/** Build the full SEO document for a taxonomy landing page. */
export function taxonomySeo(
  node: SeoTaxonomyInput,
  options?: Parameters<typeof buildTaxonomySeoDocument>[1],
): SeoDocument {
  return buildTaxonomySeoDocument(node, options);
}

/**
 * Convert an `SeoDocument` into Next `Metadata`.
 *
 * Every page's metadata goes through this one function, so no page can ship
 * with a missing canonical, an absent robots directive, or an OG card that
 * disagrees with the `<title>`.
 */
export function toMetadata(document: SeoDocument): Metadata {
  return {
    title: document.title,
    description: document.description,
    alternates: { canonical: document.canonical },
    robots: {
      index: document.robots.index,
      follow: document.robots.follow,
      googleBot: { index: document.robots.index, follow: document.robots.follow },
    },
    openGraph: {
      title: document.openGraph.title,
      description: document.openGraph.description,
      url: document.openGraph.url,
      siteName: document.openGraph.siteName,
      type: document.openGraph.type,
      locale: document.openGraph.locale,
      images: document.openGraph.images.map((image) => ({
        url: image.url,
        alt: image.alt,
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
      })),
    },
    twitter: {
      card: document.twitter.card,
      title: document.twitter.title,
      description: document.twitter.description,
      images: document.twitter.images,
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy helpers, retained for pages still on the old search-URL shape.
// ---------------------------------------------------------------------------

/**
 * Canonical for a `/search` view. Search is a tool, not a landing page: this
 * canonicalises a filtered view back to the single-facet form the taxonomy
 * pages own, and everything else is `noindex, follow`.
 */
export function searchCanonical(params: {
  category?: string;
  brand?: string;
  q?: string;
}): string {
  const decision = decideFacetIndexability(params as FacetState);
  if (decision.landingFacet && decision.robots.index) {
    return engineAbsoluteUrl(
      searchPath({ [decision.landingFacet]: decision.landingValue }),
    );
  }
  return engineAbsoluteUrl(searchPath({}));
}

export const NOINDEX_ROBOTS = {
  index: false,
  // `follow`, not `nofollow`: a suppressed page must still pass crawl equity
  // to the listings it links to, or those listings become orphans.
  follow: true,
  googleBot: { index: false, follow: true },
} as const;

export const INDEX_ROBOTS = {
  index: true,
  follow: true,
} as const;
