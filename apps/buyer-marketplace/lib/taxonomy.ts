/**
 * Taxonomy landing-page data access.
 *
 * Landing pages exist because the catalog contains enough inventory to justify
 * them, not because anyone configured them. This module asks the API which
 * nodes exist and how much inventory each has; the shared engine then decides
 * whether each one is indexable. A new category with enough listings becomes a
 * live, indexed, sitemap-listed page on the next revalidation with no code
 * change and no deploy.
 */

import { INTERNAL_API_URL } from "@/lib/api";
import type { BrowseResponse } from "@/lib/types";
import type { SeoTaxonomyKind } from "@repo/catalog-contracts";

export interface TaxonomyNode {
  kind: SeoTaxonomyKind;
  name: string;
  slug: string;
  productCount: number;
  parents?: Array<{ kind: SeoTaxonomyKind; name: string }>;
  year?: number;
  indexable: boolean;
  updatedAt?: string;
}

/** Every taxonomy node the catalog currently supports. */
export async function getTaxonomy(options?: {
  kind?: SeoTaxonomyKind;
  indexableOnly?: boolean;
}): Promise<TaxonomyNode[]> {
  const params = new URLSearchParams();
  if (options?.kind) params.set("kind", options.kind);
  if (options?.indexableOnly) params.set("indexableOnly", "true");

  try {
    const res = await fetch(`${INTERNAL_API_URL}/seo/taxonomy?${params}`, {
      // Taxonomy shifts on the timescale of an import, not a request.
      next: { revalidate: 900, tags: ["seo:taxonomy"] },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: TaxonomyNode[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a URL slug back to its catalog value.
 *
 * Returns null for a slug that matches no inventory — the page then 404s
 * rather than rendering an empty grid, because an empty landing page is a
 * soft 404 and a thin page at the same time.
 */
export async function resolveTaxonomyNode(
  kind: SeoTaxonomyKind,
  slug: string,
  parentSlug?: string,
): Promise<TaxonomyNode | null> {
  const params = new URLSearchParams({ kind, slug });
  if (parentSlug) params.set("parent", parentSlug);

  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/seo/taxonomy/resolve?${params}`,
      {
        next: { revalidate: 900, tags: ["seo:taxonomy"] },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as TaxonomyNode;
  } catch {
    return null;
  }
}

/**
 * The listings shown on a taxonomy page.
 *
 * Reuses the browse endpoint the search page uses — the landing page is a
 * curated, indexable *view* of the same inventory, not a parallel data path,
 * so there is no way for the two to disagree about what a category contains.
 */
export async function getTaxonomyListings(
  node: TaxonomyNode,
  options: { page?: number; pageSize?: number } = {},
): Promise<BrowseResponse | null> {
  const params = new URLSearchParams();

  switch (node.kind) {
    case "category":
      params.set("category", node.name);
      break;
    case "categoryGroup":
      params.set("categoryGroup", node.name);
      break;
    case "brand":
      params.set("brand", node.name);
      break;
    case "make":
      params.set("make", node.name);
      break;
    case "model":
    case "modelYear": {
      // Browse filters by make; the model narrows within it. Without a model
      // facet on the browse endpoint this is the closest honest query, and
      // the page says so rather than implying a stricter filter than it ran.
      const make = node.parents?.find((parent) => parent.kind === "make")?.name;
      if (make) params.set("make", make);
      params.set("q", node.name);
      break;
    }
    default:
      return null;
  }

  params.set("page", String(Math.max(1, options.page ?? 1)));
  params.set("pageSize", String(options.pageSize ?? 48));
  params.set("sort", "newest");

  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?${params}`, {
      next: { revalidate: 300, tags: ["seo:taxonomy"] },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as BrowseResponse;
  } catch {
    return null;
  }
}

/**
 * Sibling and child nodes to link to from a landing page.
 *
 * This is the "down and across" half of the internal-linking contract: the
 * PDP links up into its taxonomy, and taxonomy pages link back down into
 * their neighbours, so every indexable page is reachable within a few hops of
 * the homepage. Only indexable nodes are linked — pointing crawlers at
 * below-threshold pages would spend crawl budget on pages we chose not to
 * index.
 */
export async function getSiblingLinks(
  node: TaxonomyNode,
  limit = 24,
): Promise<TaxonomyNode[]> {
  const all = await getTaxonomy({ kind: node.kind, indexableOnly: true });
  return all
    .filter((candidate) => candidate.slug !== node.slug)
    .slice(0, limit);
}
