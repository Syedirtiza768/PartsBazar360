/**
 * Shared plumbing for taxonomy route files.
 *
 * Each route file is then four lines: resolve, render. Keeping the resolve →
 * 404 → metadata → render sequence in one place means a new taxonomy route
 * cannot accidentally skip the canonical, the robots decision, or the
 * page-number validation.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SeoTaxonomyKind } from "@repo/catalog-contracts";
import { TaxonomyLanding, toTaxonomyInput } from "@/components/TaxonomyLanding";
import { taxonomySeo, toMetadata } from "@/lib/seo";
import { resolveTaxonomyNode } from "@/lib/taxonomy";

/**
 * Landing pages are ISR at 15 minutes: fresh enough for inventory, cheap
 * enough to crawl. Route files repeat this as a literal because Next only
 * accepts a statically-analysable value for a `revalidate` segment config —
 * an imported constant is rejected at build time.
 */
export const TAXONOMY_REVALIDATE = 900;

/** Parse a `/page/N` segment. Anything non-numeric is page 1, not an error. */
export function parsePageParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Metadata for a taxonomy page.
 *
 * `totalPages` is not known at metadata time (it needs the listing query), and
 * it does not affect the title, description, canonical, or robots decision —
 * those depend only on the node and the page number — so metadata is generated
 * without paying for a second listings fetch.
 */
export async function taxonomyMetadata(options: {
  kind: SeoTaxonomyKind;
  slug: string;
  parentSlug?: string;
  page?: number;
}): Promise<Metadata> {
  const node = await resolveTaxonomyNode(
    options.kind,
    options.slug,
    options.parentSlug,
  );
  if (!node) {
    return {
      title: "Not found | PartsBazar360",
      robots: { index: false, follow: true },
    };
  }
  const page = options.page ?? 1;
  return toMetadata(taxonomySeo(toTaxonomyInput(node, page, page)));
}

/** Resolve and render, or 404. */
export async function renderTaxonomy(options: {
  kind: SeoTaxonomyKind;
  slug: string;
  parentSlug?: string;
  page?: number;
}) {
  const node = await resolveTaxonomyNode(
    options.kind,
    options.slug,
    options.parentSlug,
  );
  // An unknown slug is a real 404. Redirecting it to the catalog root would
  // be a soft 404 and would teach crawlers that any invented slug "works".
  if (!node) notFound();
  return <TaxonomyLanding node={node} page={options.page ?? 1} />;
}
