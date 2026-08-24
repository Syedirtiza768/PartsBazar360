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
import { FilterDrawer } from "@/components/FilterDrawer";
import { QuickFilterRow } from "@/components/FilterSectionsClient";
import {
  ActiveFilterChips,
  buildHref,
  countActiveFilters,
  type SearchParamsShape,
} from "@/components/FilterSidebar";
import { SeoLinkCloud } from "@/components/SeoLinkCloud";
import { taxonomySeo } from "@/lib/seo";
import type { FacetsResponse } from "@/lib/types";
import {
  getSiblingLinks,
  getTaxonomyListings,
  type TaxonomyNode,
} from "@/lib/taxonomy";

const PAGE_SIZE = 48;
function taxonomyScopeParams(node: TaxonomyNode): SearchParamsShape {
  switch (node.kind) {
    case "category":
      return { category: node.name };
    case "categoryGroup":
      return { categoryGroup: node.name };
    case "brand":
      return { brand: node.name };
    case "make":
      return { make: node.name };
    case "model":
    case "modelYear": {
      const make = node.parents?.find((parent) => parent.kind === "make")?.name;
      return {
        ...(make ? { make } : {}),
        q: node.name,
      };
    }
    default:
      return {};
  }
}

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
  searchParams,
}: {
  node: TaxonomyNode;
  page: number;
  searchParams?: SearchParamsShape;
}) {
  const rawFilterParams = searchParams ?? {};
  const filterParams: SearchParamsShape = {
    ...taxonomyScopeParams(node),
    ...rawFilterParams,
  };
  const results = await getTaxonomyListings(node, {
    page,
    pageSize: PAGE_SIZE,
    filters: filterParams,
  });

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
      url: part.slug
        ? absoluteUrl(partPath(part.slug))
        : absoluteUrl(`/part/${part.id}`),
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
  const facets: FacetsResponse = results.facets ?? {
    brands: [],
    categories: [],
    categoryGroups: [],
    makes: [],
    partTypes: [],
    conditions: [],
    sourceTags: [],
  };
  const taxonomyBasePath = taxonomyPath({ ...input, page: 1 });
  const hasFacets = Object.values(facets).some((values) => values.length > 0);

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

      {hasFacets && (
        <div className="mt-6 space-y-3">
          <div className="sticky top-[7.75rem] z-30 -mx-2 flex min-h-14 items-center justify-between gap-3 border-y border-slate-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85 md:top-[6.5rem]">
            <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
              Refine these listings
            </p>
            <FilterDrawer
              activeCount={countActiveFilters(rawFilterParams)}
              facets={facets}
              params={filterParams}
              resultCount={results.total}
              path={taxonomyBasePath}
            />
          </div>
          <div className="hidden lg:block">
            <QuickFilterRow
              facets={facets}
              params={filterParams}
              resultCount={results.total}
              path={taxonomyBasePath}
            />
          </div>
          <ActiveFilterChips params={rawFilterParams} path={taxonomyBasePath} />
        </div>
      )}

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
                buildHref(
                  rawFilterParams,
                  {},
                  taxonomyPath({ ...input, page: target }),
                )
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
