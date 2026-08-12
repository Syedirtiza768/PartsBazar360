import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@repo/ui/empty-state";
import { SearchIcon } from "@repo/ui/icons";
import {
  absoluteUrl,
  partPath,
  taxonomyPath,
  titleCase,
  type SeoInternalLink,
  type SeoTaxonomyInput,
} from "@repo/catalog-contracts";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Pagination } from "@/components/Pagination";
import { ProductCard } from "@/components/ProductCard";
import { SeoLinkCloud } from "@/components/SeoLinkCloud";
import { taxonomySeo } from "@/lib/seo";
import {
  getSiblingLinks,
  getTaxonomyListings,
  type TaxonomyNode,
} from "@/lib/taxonomy";

const PAGE_SIZE = 48;

/**
 * Turn a resolved taxonomy node into the engine's input shape.
 *
 * The listing count comes from the catalog, not from the current page of
 * results, because eligibility is a property of the node's whole inventory.
 */
export function toTaxonomyInput(
  node: TaxonomyNode,
  page: number,
  totalPages: number,
): SeoTaxonomyInput {
  return {
    kind: node.kind,
    name: node.name,
    productCount: node.productCount,
    ...(node.parents ? { parents: node.parents } : {}),
    ...(node.year !== undefined ? { year: node.year } : {}),
    ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
    page,
    totalPages,
  };
}

/**
 * One renderer for every taxonomy landing page.
 *
 * Categories, systems, brands, makes, and models all render through this, so
 * a new taxonomy dimension is a new route file plus a resolver call — the
 * metadata, canonical, breadcrumbs, schema, pagination, and internal links
 * come with it. That is what stops SEO quality depending on which developer
 * wrote which landing page.
 */
export async function TaxonomyLanding({
  node,
  page,
}: {
  node: TaxonomyNode;
  page: number;
}) {
  const results = await getTaxonomyListings(node, { page, pageSize: PAGE_SIZE });

  // A node the catalog reports but that returns nothing is a soft 404 waiting
  // to happen: 404 outright rather than publishing an empty indexable grid.
  if (!results || results.total === 0) notFound();

  const totalPages = Math.max(
    1,
    Math.min(
      Math.ceil(results.total / (results.limit || PAGE_SIZE)),
      results.maxPage || Number.MAX_SAFE_INTEGER,
    ),
  );

  // A page number past the end is not a real page. 404 instead of rendering
  // an empty one, so crawlers cannot walk into unbounded pagination.
  if (page > totalPages) notFound();

  const input = toTaxonomyInput(node, page, totalPages);
  const seo = taxonomySeo(input, {
    items: results.items.map((part) => ({
      url: part.slug ? absoluteUrl(partPath(part.slug)) : absoluteUrl(`/part/${part.id}`),
      name: part.title,
    })),
  });

  const siblings = await getSiblingLinks(node);
  const siblingLinks: SeoInternalLink[] = siblings.map((sibling) => ({
    label: titleCase(sibling.name),
    path: taxonomyPath({
      kind: sibling.kind,
      name: sibling.name,
      productCount: sibling.productCount,
      ...(sibling.parents ? { parents: sibling.parents } : {}),
    }),
    relation:
      sibling.kind === "categoryGroup"
        ? "categoryGroup"
        : sibling.kind === "modelYear"
          ? "model"
          : sibling.kind,
  }));

  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, results.total);

  return (
    <div className="mx-auto max-w-wide gutter py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.structuredData) }}
      />

      <Breadcrumbs
        crumbs={seo.breadcrumbs.map((crumb, index) => ({
          ...(index < seo.breadcrumbs.length - 1 ? { href: crumb.path } : {}),
          label: crumb.name,
        }))}
      />

      <header className="mt-3">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {seo.h1}
        </h1>
        <p className="mt-1 text-sm text-graphite-600">
          Showing{" "}
          <span className="font-semibold text-slate-900">
            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-slate-900">
            {results.total.toLocaleString()}
          </span>{" "}
          {results.total === 1 ? "listing" : "listings"}
        </p>
        {/* The description is real page copy, not just a meta tag: it is the
            unique text that distinguishes this landing page from its siblings
            and keeps it from being a thin, templated duplicate. */}
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-graphite-700">
          {seo.description}
        </p>
      </header>

      <section aria-label="Listings" className="pt-6">
        {results.items.length === 0 ? (
          <EmptyState
            variant="page"
            icon={<SearchIcon />}
            title="No listings on this page"
            description="Inventory changes daily. Browse the full catalog for current stock."
          >
            <Link href="/search">Browse all parts</Link>
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5">
              {results.items.map((part) => (
                <ProductCard key={part.id} part={part} />
              ))}
            </div>

            {/* Real anchors, server-rendered: this is how a crawler reaches
                deep inventory. Pages past 1 are noindex but still followed,
                so the listings on them are discoverable. */}
            <Pagination
              page={page}
              totalPages={totalPages}
              hrefFor={(target) =>
                taxonomyPath({ ...input, page: target })
              }
            />
          </>
        )}
      </section>

      <SeoLinkCloud
        heading={`Other ${node.kind === "brand" ? "brands" : node.kind === "make" || node.kind === "model" ? "vehicles" : "categories"}`}
        links={siblingLinks}
      />
    </div>
  );
}
