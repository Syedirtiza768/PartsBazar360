import {
  absoluteUrl,
  partPath,
  renderSitemap,
  seoConfig,
  taxonomyPath,
  type SeoTaxonomyKind,
  type SitemapEntry,
} from "@repo/catalog-contracts";
import { getSitemapParts } from "@/lib/sitemap-source";
import { getTaxonomy, type TaxonomyNode } from "@/lib/taxonomy";

/**
 * All sitemap files below the index — /sitemaps/<file>.
 *
 * One route rather than five because Next only supports whole-segment dynamic
 * params (`parts-[page].xml` is not a valid segment name), and because the
 * cache headers, the environment gate, and the "indexable only" rule should
 * be stated once rather than copied per file.
 *
 * Every URL emitted here has been through the engine's index-eligibility
 * decision. A sitemap that lists a `noindex` URL is a direct contradiction —
 * it asks Google to crawl something the page then tells it to drop — so
 * eligibility is filtered at the source rather than trusted downstream.
 */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * Static pages worth indexing.
 *
 * Account, cart, and checkout are absent because they are private. `/search`
 * is absent because it is `noindex` — listing a noindex URL in a sitemap asks
 * Google to crawl something the page then tells it to drop, and it is exactly
 * what the SEO validator flags as `sitemap.excluded`. Its indexable
 * equivalents are the taxonomy landing pages below.
 */
const STATIC_ROUTES: SitemapEntry[] = [
  { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
  { url: absoluteUrl("/support"), changeFrequency: "monthly", priority: 0.3 },
  { url: absoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.3 },
  { url: absoluteUrl("/privacy-policy"), changeFrequency: "yearly", priority: 0.2 },
];

function taxonomyEntries(
  nodes: TaxonomyNode[],
  kinds: SeoTaxonomyKind[],
  priority: number,
): SitemapEntry[] {
  return nodes
    .filter((node) => kinds.includes(node.kind) && node.indexable)
    .map((node) => ({
      url: absoluteUrl(
        taxonomyPath({
          kind: node.kind,
          name: node.name,
          productCount: node.productCount,
          ...(node.parents ? { parents: node.parents } : {}),
          ...(node.year !== undefined ? { year: node.year } : {}),
        }),
      ),
      ...(node.updatedAt ? { lastModified: node.updatedAt } : {}),
      changeFrequency: "daily" as const,
      priority,
    }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;

  // A non-production deployment serves empty sitemaps rather than 404s, so a
  // stray crawl of staging finds nothing instead of finding real URLs.
  if (!seoConfig().indexingEnabled) return xml(renderSitemap([]));

  const partsMatch = /^parts-(\d+)\.xml$/.exec(file);
  if (partsMatch) {
    const items = await getSitemapParts(Number.parseInt(partsMatch[1]!, 10));
    return xml(
      renderSitemap(
        items.map((item) => ({
          url: absoluteUrl(partPath(item.slug)),
          // The part's real change time, not the generation time. Stamping
          // "now" on every URL is how a site teaches Google to ignore lastmod.
          lastModified: item.lastModified,
          changeFrequency: "weekly" as const,
          priority: 0.7,
        })),
      ),
    );
  }

  switch (file) {
    case "static.xml":
      return xml(renderSitemap(STATIC_ROUTES));

    case "categories.xml": {
      const nodes = await getTaxonomy({ indexableOnly: true });
      return xml(
        renderSitemap(taxonomyEntries(nodes, ["categoryGroup", "category"], 0.8)),
      );
    }

    case "brands.xml": {
      const nodes = await getTaxonomy({ kind: "brand", indexableOnly: true });
      return xml(renderSitemap(taxonomyEntries(nodes, ["brand"], 0.75)));
    }

    case "vehicles.xml": {
      const nodes = await getTaxonomy({ indexableOnly: true });
      return xml(renderSitemap(taxonomyEntries(nodes, ["make", "model"], 0.75)));
    }

    default:
      return new Response("Not found", { status: 404 });
  }
}

function xml(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Served from the edge for an hour, stale for a day: a crawl burst
      // costs one origin generation, and a slow API never 500s a sitemap.
      "Cache-Control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
