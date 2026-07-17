import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { SearchIcon, CarIcon } from "@repo/ui/icons";
import { INTERNAL_API_URL, SITE_URL } from "@/lib/api";
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
    sort?: "newest" | "price_asc" | "price_desc";
    page?: string;
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
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", params.page);
  qs.set("limit", String(PAGE_SIZE));

  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?${qs.toString()}`, {
      cache: "no-store",
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
  const title =
    parts.length > 0 ? `${parts.join(" ")} Parts | PartsBazar360` : "Shop All Auto Parts | PartsBazar360";
  const description = params.vehicleConfigId
    ? "Browse fitment-verified parts for your exact vehicle configuration."
    : "Browse thousands of live, fitment-checked used and OEM auto parts from verified marketplace sellers.";

  const canonicalParams = new URLSearchParams();
  if (params.vehicleConfigId) canonicalParams.set("vehicleConfigId", params.vehicleConfigId);
  if (params.category) canonicalParams.set("category", params.category);
  if (params.brand) canonicalParams.set("brand", params.brand);
  if (params.q) canonicalParams.set("q", params.q);
  const canonicalQs = canonicalParams.toString();

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/search${canonicalQs ? `?${canonicalQs}` : ""}` },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const isFitmentMode = Boolean(params.vehicleConfigId);
  const page = Math.max(1, params.page ? parseInt(params.page, 10) || 1 : 1);
  const sort = params.sort || "newest";

  const [resultsRaw, facets] = await Promise.all([getResults(params), getFacets()]);

  // Vehicle search returns the full verified-fit set in one response —
  // paginate it here so long lists stay usable.
  let results = resultsRaw;
  let totalPages = 1;
  if (resultsRaw) {
    if (isFitmentMode) {
      totalPages = Math.max(1, Math.ceil(resultsRaw.items.length / PAGE_SIZE));
      results = {
        ...resultsRaw,
        items: resultsRaw.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      };
    } else {
      totalPages = Math.max(1, Math.ceil(resultsRaw.total / (resultsRaw.limit || PAGE_SIZE)));
    }
  }

  const paramsShape: SearchParamsShape = {
    vehicleConfigId: params.vehicleConfigId,
    q: params.q,
    category: params.category,
    brand: params.brand,
    sort: params.sort,
  };

  const activeFilterCount = [params.category, params.brand].filter(Boolean).length;
  const showFilters = !isFitmentMode && (facets.categories.length > 0 || facets.brands.length > 0);

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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {results === null ? (
                "Results unavailable"
              ) : (
                <>
                  {(isFitmentMode ? resultsRaw!.items.length : results.total).toLocaleString()}{" "}
                  {isFitmentMode ? "verified-fit " : ""}
                  {(isFitmentMode ? resultsRaw!.items.length : results.total) === 1 ? "part" : "parts"}
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {showFilters && (
              <FilterDrawer activeCount={activeFilterCount}>
                <FilterSections facets={facets} params={paramsShape} />
              </FilterDrawer>
            )}
            {isFitmentMode ? (
              <p className="text-sm text-slate-500">Sorted by lowest price</p>
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
          <aside className="hidden w-60 shrink-0 lg:block" aria-label="Filters">
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
                  : params.q
                    ? "Check the spelling, try fewer words, or search by the OE part number for exact matches."
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
                <Link href="/search" className={buttonClasses({ variant: "outline" })}>
                  Clear search &amp; filters
                </Link>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
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
