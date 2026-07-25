import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { SearchIcon, CarIcon } from "@repo/ui/icons";
import { INTERNAL_API_URL } from "@/lib/api";
import { NOINDEX_ROBOTS, searchCanonical } from "@/lib/seo";
import { ProductCard } from "@/components/ProductCard";
import { SortSelect } from "@/components/SortSelect";
import { Pagination } from "@/components/Pagination";
import { VehicleModeBanner } from "@/components/VehicleModeBanner";
import { FilterDrawer } from "@/components/FilterDrawer";
import {
  FilterSections,
  ActiveFilterChips,
  buildHref,
  type SearchParamsShape,
} from "@/components/FilterSidebar";
import type { BrowseResponse, FacetsResponse } from "@/lib/types";

const PAGE_SIZE = 24;

interface SearchPageProps {
  searchParams: Promise<{
    vehicleConfigId?: string;
    q?: string;
    category?: string;
    brand?: string;
    partType?: string;
    sort?: "newest" | "price_asc" | "price_desc";
    page?: string;
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
  if (params.brand) qs.set("brand", params.brand);
  if (params.partType) qs.set("partType", params.partType);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", params.page);
  // Only send when the buyer opted out — the API defaults interchange on.
  if (params.includeInterchange === "false") qs.set("includeInterchange", "false");
  qs.set("limit", String(PAGE_SIZE));

  try {
    // Anonymous catalog browse is safe to cache briefly. Fitment / vehicle
    // searches stay live so stock and verified-fit sets stay current.
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?${qs.toString()}`, {
      ...(params.vehicleConfigId
        ? { cache: "no-store" as const }
        : { next: { revalidate: 30 } }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getFacets(): Promise<FacetsResponse> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { brands: [], categories: [] };
    return res.json();
  } catch {
    return { brands: [], categories: [] };
  }
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const parts: string[] = [];
  if (params.brand) parts.push(params.brand);
  if (params.category) parts.push(params.category);
  if (params.q) parts.push(`"${params.q}"`);

  const isHub = Boolean(params.category || params.brand) && !params.q && !params.vehicleConfigId;
  const isAllParts = !params.category && !params.brand && !params.q && !params.vehicleConfigId;
  const pageNum = Math.max(1, params.page ? parseInt(params.page, 10) || 1 : 1);

  // Index category/brand hubs and the main catalog. Keep vehicle fitment,
  // free-text search, sort variants, multi-filter combos, and deep pagination
  // out of the index to protect crawl budget.
  const shouldNoIndex =
    Boolean(params.vehicleConfigId) ||
    Boolean(params.q) ||
    Boolean(params.sort && params.sort !== "newest") ||
    Boolean(params.partType) ||
    Boolean(params.includeInterchange === "false") ||
    (Boolean(params.category) && Boolean(params.brand)) ||
    pageNum > 1;

  const title = isAllParts
    ? "Shop All Auto Parts | PartsBazar360"
    : isHub && params.brand && params.category
      ? `${params.brand} ${params.category} Parts | PartsBazar360`
      : isHub && params.brand
        ? `${params.brand} Auto Parts | PartsBazar360`
        : isHub && params.category
          ? `${params.category} Parts | PartsBazar360`
          : parts.length > 0
            ? `${parts.join(" ")} Parts | PartsBazar360`
            : "Shop All Auto Parts | PartsBazar360";

  const description = params.vehicleConfigId
    ? "Browse fitment-verified parts for your exact vehicle configuration."
    : params.brand && params.category
      ? `Shop ${params.brand} ${params.category.toLowerCase()} parts with visible fitment evidence, condition, and seller terms on PartsBazar360.`
      : params.brand
        ? `Browse ${params.brand} automotive parts from marketplace sellers. Compare condition, OE numbers, and seller shipping before you buy.`
        : params.category
          ? `Shop ${params.category.toLowerCase()} parts with fitment evidence and seller-visible terms. New, used, and OEM inventory updated daily.`
          : params.q
            ? `Search results for ${params.q} across live marketplace inventory.`
            : "Browse live used and OEM auto parts from marketplace sellers. Filter by category, brand, or OE number with fitment evidence on every listing.";

  const canonical = searchCanonical({
    category: params.category,
    brand: params.brand,
    // Free-text and vehicle searches canonicalize to the hub without q/vehicle.
    q: shouldNoIndex ? undefined : params.q,
  });

  return {
    title,
    description,
    alternates: { canonical },
    robots: shouldNoIndex ? NOINDEX_ROBOTS : undefined,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const isFitmentMode = Boolean(params.vehicleConfigId);
  const page = Math.max(1, params.page ? parseInt(params.page, 10) || 1 : 1);
  const sort = params.sort || "newest";

  const [resultsRaw, facets] = await Promise.all([getResults(params), getFacets()]);

  // Both browse and fitment search are server-paginated via the API.
  const results = resultsRaw;
  let totalPages = 1;
  if (resultsRaw) {
    totalPages = Math.max(1, Math.ceil(resultsRaw.total / (resultsRaw.limit || PAGE_SIZE)));
  }

  const paramsShape: SearchParamsShape = {
    vehicleConfigId: params.vehicleConfigId,
    q: params.q,
    category: params.category,
    brand: params.brand,
    partType: params.partType,
    sort: params.sort,
    includeInterchange: params.includeInterchange,
  };

  const activeFilterCount = [params.category, params.brand, params.partType].filter(Boolean).length;
  const showFilters = !isFitmentMode && (facets.categories.length > 0 || facets.brands.length > 0);
  const interchangeOff = params.includeInterchange === "false";

  const heading = isFitmentMode
    ? "Parts that fit your vehicle"
    : params.q
      ? `Results for “${params.q}”`
      : params.category
        ? `${params.category} parts`
        : params.brand
          ? `${params.brand} parts`
          : "Shop all parts";

  return (
    <div className="mx-auto max-w-wide gutter py-6 sm:py-8">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-graphite-600">
              {results === null ? (
                "Results unavailable"
              ) : (
                <>
                  {results.total.toLocaleString()}{" "}
                  {isFitmentMode ? "verified-fit " : ""}
                  {results.total === 1 ? "part" : "parts"}
                </>
              )}
            </p>
          </div>

          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            {showFilters && (
              <FilterDrawer activeCount={activeFilterCount}>
                <FilterSections facets={facets} params={paramsShape} />
              </FilterDrawer>
            )}
            {isFitmentMode ? (
              <p className="text-sm text-graphite-600">Sorted by lowest price</p>
            ) : (
              <SortSelect current={sort} />
            )}
          </div>
        </div>

        <ActiveFilterChips params={paramsShape} />
        {isFitmentMode && <VehicleModeBanner configId={params.vehicleConfigId!} />}
      </div>

      <div className="flex flex-col gap-8 pt-6 lg:flex-row">
        {/* Filters sidebar — plain links so filtering works without JS and is fully crawlable */}
        {showFilters && (
          <aside className="hidden w-60 shrink-0 self-start lg:sticky lg:top-28 lg:block" aria-label="Filters">
            <FilterSections facets={facets} params={paramsShape} />
          </aside>
        )}

        <div className="min-w-0 flex-1">
          {results === null ? (
            <EmptyState
              variant="page"
              icon={<SearchIcon />}
              title="We couldn't load results"
              description="Something went wrong on our side. Reload the page or try again in a moment."
            >
              <Link href={buildHref(paramsShape, {})} className={buttonClasses({ variant: "outline" })}>
                Try again
              </Link>
            </EmptyState>
          ) : results.items.length === 0 ? (
            <EmptyState
              variant="page"
              icon={isFitmentMode ? <CarIcon /> : <SearchIcon />}
              title={isFitmentMode ? "No verified-fit parts for this vehicle yet" : "No parts match"}
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
                  <Link href="/support" className={buttonClasses({ variant: "outline" })}>
                    Ask support
                  </Link>
                </>
              ) : (
                <>
                  {interchangeOff && params.q && (
                    <Link
                      href={buildHref(paramsShape, { includeInterchange: undefined })}
                      className={buttonClasses()}
                    >
                      Include interchange numbers
                    </Link>
                  )}
                  {params.q && (
                    <Link
                      href={`/support?category=GENERAL&subject=${encodeURIComponent(`Source request: ${params.q}`)}`}
                      className={buttonClasses({ variant: interchangeOff ? "outline" : "primary" })}
                    >
                      Ask us to source “{params.q}”
                    </Link>
                  )}
                  <Link href="/search" className={buttonClasses({ variant: "outline" })}>
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
