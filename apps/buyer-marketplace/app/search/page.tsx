import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { SearchIcon, CarIcon } from "@repo/ui/icons";
import {
  absoluteUrl,
  decideFacetIndexability,
  searchPath,
  taxonomyPath,
  type FacetState,
} from "@repo/catalog-contracts";
import { INTERNAL_API_URL } from "@/lib/api";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import { ProductCard } from "@/components/ProductCard";
import { SortSelect } from "@/components/SortSelect";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { Pagination } from "@/components/Pagination";
import { VehicleModeBanner } from "@/components/VehicleModeBanner";
import { FilterDrawer } from "@/components/FilterDrawer";
import { QuickFilterRow } from "@/components/FilterSectionsClient";
import {
  ActiveFilterChips,
  countActiveFilters,
  buildHref,
  type SearchParamsShape,
} from "@/components/FilterSidebar";
import type { BrowseResponse, FacetsResponse } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 75;
const ALLOWED_PAGE_SIZES = [75, 150, 300] as const;

function resolvePageSize(value?: string): number {
  const n = value ? parseInt(value, 10) : DEFAULT_PAGE_SIZE;
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_PAGE_SIZE;
}

interface SearchPageProps {
  searchParams: Promise<{
    vehicleConfigId?: string;
    q?: string;
    category?: string;
    categoryGroup?: string;
    brand?: string;
    make?: string;
    partType?: string;
    sourceTag?: string;
    minPrice?: string;
    maxPrice?: string;
    sort?: "relevance" | "newest" | "price_asc" | "price_desc";
    page?: string;
    pageSize?: string;
    includeInterchange?: string;
  }>;
}

// null = request failed (distinct from an empty result set).
async function getResults(
  params: Awaited<SearchPageProps["searchParams"]>,
): Promise<BrowseResponse | null> {
  const qs = new URLSearchParams();
  if (params.vehicleConfigId) qs.set("vehicleConfigId", params.vehicleConfigId);
  if (params.q) qs.set("q", params.q);
  if (params.category) qs.set("category", params.category);
  if (params.categoryGroup) qs.set("categoryGroup", params.categoryGroup);
  if (params.brand) qs.set("brand", params.brand);
  if (params.make) qs.set("make", params.make);
  if (params.partType) qs.set("partType", params.partType);
  if (params.sourceTag) qs.set("sourceTag", params.sourceTag);
  if (params.minPrice) qs.set("minPrice", params.minPrice);
  if (params.maxPrice) qs.set("maxPrice", params.maxPrice);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", params.page);
  // Only send when the buyer opted out — the API defaults interchange on.
  if (params.includeInterchange === "false")
    qs.set("includeInterchange", "false");
  qs.set("pageSize", String(resolvePageSize(params.pageSize)));

  try {
    // Anonymous catalog browse is safe to cache briefly. Fitment / vehicle
    // searches stay live so stock and verified-fit sets stay current.
    const res = await fetch(
      `${INTERNAL_API_URL}/search/parts?${qs.toString()}`,
      {
        ...(params.vehicleConfigId
          ? { cache: "no-store" as const }
          : { next: { revalidate: 30 } }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Search is a tool, not an SEO surface.
 *
 * Every `/search` URL is `noindex, follow`: the indexable equivalents are the
 * taxonomy landing pages (`/parts/category/…`, `/brands/…`, `/vehicles/…`),
 * which carry real copy, breadcrumbs, and collection markup. Indexing search
 * URLs *as well* would put two of our own pages in front of the same query and
 * expose every filter permutation as a crawlable near-duplicate.
 *
 * `follow` matters: the result grid is a legitimate discovery path into deep
 * inventory, so links from it are still crawled. And when the filter state
 * corresponds to exactly one taxonomy node, the canonical points at that
 * node's landing page, consolidating any signals the search URL picks up.
 */
export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const decision = decideFacetIndexability(params as FacetState);

  const label = [params.brand, params.category, params.make]
    .filter(Boolean)
    .join(" ");
  const title = params.q
    ? `Search results for “${params.q}” | PartsBazar360`
    : label
      ? `${label} parts — search | PartsBazar360`
      : "Search auto parts | PartsBazar360";

  const description = params.q
    ? `Live marketplace results for “${params.q}”. Compare condition, part numbers, seller terms and shipping.`
    : "Search new, used and OEM automotive parts by vehicle, part number or category with visible fitment evidence and seller terms.";

  // A single-facet search consolidates into the landing page that owns that
  // term; anything else consolidates into the bare search entry point.
  const canonical =
    decision.landingFacet && decision.landingValue
      ? absoluteUrl(
          taxonomyPath({
            kind: decision.landingFacet === "categoryGroup" ? "categoryGroup" : decision.landingFacet,
            name: decision.landingValue,
            productCount: 0,
          }),
        )
      : absoluteUrl(searchPath({}));

  return {
    title,
    description,
    alternates: { canonical },
    robots: NOINDEX_ROBOTS,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const isFitmentMode = Boolean(params.vehicleConfigId);
  const page = Math.max(1, params.page ? parseInt(params.page, 10) || 1 : 1);
  const pageSize = resolvePageSize(params.pageSize);
  const hasQuery = Boolean(params.q);
  // Relevance is the default for a keyword search; a no-query browse defaults
  // to newest so the feed order is stable rather than score-arbitrary.
  const sort = params.sort || (hasQuery ? "relevance" : "newest");

  const results = await getResults(params);

  // Browse returns post-filter facets scoped to the active filters, so counts
  // always agree with the visible result set (the old sidebar's global counts
  // were contradictory). Fitment mode returns no facets.
  const facets: FacetsResponse = results?.facets ?? {
    brands: [],
    categories: [],
    categoryGroups: [],
    makes: [],
    partTypes: [],
    conditions: [],
    sourceTags: [],
  };

  // Both browse and fitment search are server-paginated via the API.
  let totalPages = 1;
  if (results) {
    const raw = Math.ceil(results.total / (results.limit || pageSize));
    // Never link pages beyond the OpenSearch result window — they would load
    // empty. For catalogs under the window this is a no-op.
    totalPages = Math.max(1, Math.min(raw, results.maxPage || raw));
  }

  // A page beyond the result set (stale bookmark, hand-edited URL, or a filter
  // change that shrank the catalog while a deep page was shared) must recover
  // to the last valid page — not render "No parts match" over a query that
  // DID match (the API now reports the true total + pageOutOfRange for
  // beyond-window pages instead of a fake 0).
  if (
    results &&
    results.total > 0 &&
    results.items.length === 0 &&
    page > totalPages
  ) {
    redirect(
      buildHref(
        {
          vehicleConfigId: params.vehicleConfigId,
          q: params.q,
          category: params.category,
          categoryGroup: params.categoryGroup,
          brand: params.brand,
          make: params.make,
          partType: params.partType,
          sourceTag: params.sourceTag,
          minPrice: params.minPrice,
          maxPrice: params.maxPrice,
          sort: params.sort,
          includeInterchange: params.includeInterchange,
          pageSize: params.pageSize,
        },
        { page: String(totalPages) },
      ),
    );
  }

  const paramsShape: SearchParamsShape = {
    vehicleConfigId: params.vehicleConfigId,
    q: params.q,
    category: params.category,
    categoryGroup: params.categoryGroup,
    brand: params.brand,
    make: params.make,
    partType: params.partType,
    sourceTag: params.sourceTag,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    sort: params.sort,
    includeInterchange: params.includeInterchange,
    pageSize: params.pageSize,
  };

  const activeFilterCount = countActiveFilters(paramsShape);
  const showFilters =
    results !== null &&
    (isFitmentMode ||
      Boolean(params.q) ||
      activeFilterCount > 0 ||
      facets.categories.length > 0 ||
      facets.categoryGroups.length > 0 ||
      facets.brands.length > 0 ||
      facets.makes.length > 0 ||
      facets.partTypes.length > 0 ||
      facets.sourceTags.length > 0);
  const resultCount = results?.total;
  const interchangeOff = params.includeInterchange === "false";
  const isAtLeast = results?.totalRelation === "gte";
  // Only meaningful for a keyword search — a filter-only browse is never relaxed.
  const isRelaxed = Boolean(results?.relaxed && params.q && results.total > 0);

  const heading = isFitmentMode
    ? "Parts that fit your vehicle"
    : params.q
      ? `Results for “${params.q}”`
      : params.category
        ? `${params.category} parts`
        : params.categoryGroup
          ? `${params.categoryGroup} parts`
          : params.brand
            ? `${params.brand} parts`
            : "Shop all parts";

  const rangeStart =
    results && results.total > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = results ? Math.min(page * pageSize, results.total) : 0;

  return (
    <div className="mx-auto max-w-wide gutter py-6 sm:py-8">
      <div className="space-y-3">
        {isFitmentMode && <VehicleModeBanner configId={params.vehicleConfigId!} compact />}
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-graphite-600">
            {results === null ? (
              "Results unavailable"
            ) : results.total === 0 ? (
              isFitmentMode ? (
                "No verified-fit parts for this vehicle yet"
              ) : (
                "No matching parts"
              )
            ) : (
              <>
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-900">
                  {results.total.toLocaleString()}
                  {isAtLeast ? "+" : ""}
                </span>{" "}
                {isFitmentMode ? "verified-fit " : ""}
                {results.total === 1 ? "part" : "parts"}
              </>
            )}
          </p>
        </div>

        <div className="sticky top-[7.75rem] z-30 -mx-2 flex min-h-14 items-center justify-between gap-3 border-y border-slate-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85 md:top-[6.5rem]">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900" aria-live="polite">
            {results === null
              ? "Results unavailable"
              : `${results.total.toLocaleString()}${isAtLeast ? "+" : ""} ${isFitmentMode ? "verified-fit " : ""}${results.total === 1 ? "part" : "parts"}`}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {showFilters && (
              <FilterDrawer
                activeCount={activeFilterCount}
                facets={facets}
                params={paramsShape}
                resultCount={resultCount}
              />
            )}
            {isFitmentMode ? (
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-graphite-600">
                Sorted by lowest price
              </p>
            ) : (
              <>
                <SortSelect current={sort} />
                <div className="hidden md:block">
                  <PageSizeSelect current={pageSize} />
                </div>
              </>
            )}
          </div>
        </div>

        <ActiveFilterChips params={paramsShape} />
        {showFilters && (
          <div className="hidden lg:block">
            <QuickFilterRow facets={facets} params={paramsShape} resultCount={resultCount} />
          </div>
        )}
        {isRelaxed && (
          <p
            role="status"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            No exact matches for{" "}
            <span className="font-semibold">“{params.q}”</span> — showing
            related parts.
          </p>
        )}
      </div>

      <div className="pt-6">
        <div className="min-w-0">
          {results === null ? (
            <EmptyState
              variant="page"
              icon={<SearchIcon />}
              title="We couldn't load results"
              description="Something went wrong on our side. Reload the page or try again in a moment."
            >
              <Link
                href={buildHref(paramsShape, {})}
                className={buttonClasses({ variant: "outline" })}
              >
                Try again
              </Link>
            </EmptyState>
          ) : results.items.length === 0 ? (
            <EmptyState
              variant="page"
              icon={isFitmentMode ? <CarIcon /> : <SearchIcon />}
              title={
                isFitmentMode
                  ? "No verified-fit parts for this vehicle yet"
                  : "No parts match"
              }
              description={
                isFitmentMode
                  ? "Inventory changes daily. Try browsing the full catalog and checking listings' compatibility tables, or ask support to source the part."
                  : interchangeOff && params.q
                    ? "Interchange matching is off, so only this part's own number was searched. A superseded or cross-reference number won't match — try turning interchange on."
                    : params.q
                      ? "That number or term didn't match a listing. If it's a superseded or cross-reference number, we can still source it for you."
                      : "Try removing a filter or searching by part name or OE number."
              }
            >
              {isFitmentMode ? (
                <>
                  <Link href="/search" className={buttonClasses()}>
                    Browse all parts
                  </Link>
                  <Link
                    href="/support"
                    className={buttonClasses({ variant: "outline" })}
                  >
                    Ask support
                  </Link>
                </>
              ) : (
                <>
                  {interchangeOff && params.q && (
                    <Link
                      href={buildHref(paramsShape, {
                        includeInterchange: undefined,
                      })}
                      className={buttonClasses()}
                    >
                      Include interchange numbers
                    </Link>
                  )}
                  {params.q && (
                    <Link
                      href={`/support?category=GENERAL&subject=${encodeURIComponent(`Source request: ${params.q}`)}`}
                      className={buttonClasses({
                        variant: interchangeOff ? "outline" : "primary",
                      })}
                    >
                      Ask us to source “{params.q}”
                    </Link>
                  )}
                  <Link
                    href="/search"
                    className={buttonClasses({ variant: "outline" })}
                  >
                    Clear search &amp; filters
                  </Link>
                </>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5">
                {results.items.map((part) => (
                  <ProductCard
                    key={part.id}
                    part={part}
                    fitmentContext={isFitmentMode ? "verified" : "auto"}
                  />
                ))}
              </div>

              <Pagination
                page={page}
                totalPages={totalPages}
                hrefFor={(p) => buildHref(paramsShape, { page: String(p) })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
