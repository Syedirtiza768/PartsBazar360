import {
  absoluteUrl,
  renderSitemapIndex,
  seoConfig,
} from "@repo/catalog-contracts";
import { getSitemapSummary } from "@/lib/sitemap-source";

/**
 * Sitemap index — /sitemap.xml.
 *
 * An index rather than a single file, because the catalog is far past the
 * 50 000-URL cap on one sitemap and because a monolithic file would have to
 * be regenerated in full whenever any listing changed. Splitting by entity
 * type also lets Search Console report indexing coverage per type, which is
 * how a problem isolated to (say) vehicle pages becomes visible.
 *
 * Hand-written as a route handler rather than Next's `MetadataRoute.Sitemap`:
 * that helper cannot emit a `<sitemapindex>` at all.
 */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const { indexingEnabled } = seoConfig();

  // A non-indexable environment serves an empty index rather than 404ing, so
  // a misconfigured staging crawl finds nothing instead of finding the
  // production URL set.
  if (!indexingEnabled) {
    return xml(renderSitemapIndex([]));
  }

  const summary = await getSitemapSummary();
  const chunks = summary?.parts.chunks ?? 1;
  const now = new Date();

  const entries = [
    { url: absoluteUrl("/sitemaps/static.xml"), lastModified: now },
    ...Array.from({ length: chunks }, (_, index) => ({
      url: absoluteUrl(`/sitemaps/parts-${index + 1}.xml`),
      lastModified: now,
    })),
    { url: absoluteUrl("/sitemaps/categories.xml"), lastModified: now },
    { url: absoluteUrl("/sitemaps/brands.xml"), lastModified: now },
    { url: absoluteUrl("/sitemaps/vehicles.xml"), lastModified: now },
  ];

  return xml(renderSitemapIndex(entries));
}

function xml(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
