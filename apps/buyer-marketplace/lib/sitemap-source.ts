/**
 * Data access for sitemap generation.
 *
 * Every sitemap URL comes from a live catalog query filtered to *indexable*
 * entities. Nothing is maintained by hand, so a published listing enters the
 * sitemap on the next revalidation and a delisted one leaves it — which is
 * the requirement that sitemaps only contain canonical, indexable, 200-
 * returning URLs.
 */

import { INTERNAL_API_URL } from "@/lib/api";

export interface SitemapSummary {
  parts: { total: number; chunks: number; pageSize: number };
  taxonomy: { total: number; indexable: number; byKind: Record<string, number> };
}

export interface SitemapPart {
  slug: string;
  lastModified: string;
}

/**
 * Sitemaps are cached for an hour. Long enough that a crawl burst costs one
 * aggregation, short enough that a new listing is discoverable the same day —
 * and the on-demand revalidation hook can purge the tag sooner.
 */
const SITEMAP_REVALIDATE = 3600;

export async function getSitemapSummary(): Promise<SitemapSummary | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/seo/sitemap/summary`, {
      next: { revalidate: SITEMAP_REVALIDATE, tags: ["seo:sitemap"] },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as SitemapSummary;
  } catch {
    return null;
  }
}

export async function getSitemapParts(page: number): Promise<SitemapPart[]> {
  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/seo/sitemap/parts?page=${Math.max(1, page)}`,
      {
        next: { revalidate: SITEMAP_REVALIDATE, tags: ["seo:sitemap"] },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: SitemapPart[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
