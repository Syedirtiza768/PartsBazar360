import Link from 'next/link';
import type { Metadata } from 'next';
import { INTERNAL_API_URL, SITE_URL } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';
import { SortSelect } from '@/components/SortSelect';
import type { BrowseResponse, FacetsResponse } from '@/lib/types';

interface SearchPageProps {
  searchParams: Promise<{
    vehicleConfigId?: string;
    q?: string;
    category?: string;
    brand?: string;
    sort?: 'newest' | 'price_asc' | 'price_desc';
    page?: string;
  }>;
}

async function getResults(params: Awaited<SearchPageProps['searchParams']>): Promise<BrowseResponse> {
  const qs = new URLSearchParams();
  if (params.vehicleConfigId) qs.set('vehicleConfigId', params.vehicleConfigId);
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.brand) qs.set('brand', params.brand);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', params.page);
  qs.set('limit', '24');

  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) return { items: [], total: 0, page: 1, limit: 24 };
    return res.json();
  } catch {
    return { items: [], total: 0, page: 1, limit: 24 };
  }
}

async function getFacets(): Promise<FacetsResponse> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, { cache: 'no-store' });
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
  const title = parts.length > 0
    ? `${parts.join(' ')} Parts | PartsBazar360`
    : 'Shop All Auto Parts | PartsBazar360';
  const description = params.vehicleConfigId
    ? 'Browse fitment-verified parts for your exact vehicle configuration.'
    : 'Browse thousands of live, fitment-checked used and OEM auto parts from verified marketplace sellers.';

  const canonicalParams = new URLSearchParams();
  if (params.vehicleConfigId) canonicalParams.set('vehicleConfigId', params.vehicleConfigId);
  if (params.category) canonicalParams.set('category', params.category);
  if (params.brand) canonicalParams.set('brand', params.brand);
  if (params.q) canonicalParams.set('q', params.q);
  const canonicalQs = canonicalParams.toString();

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/search${canonicalQs ? `?${canonicalQs}` : ''}` },
  };
}

function buildHref(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const merged = { ...base, ...overrides };
  const qs = new URLSearchParams();
  Object.entries(merged).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  const str = qs.toString();
  return `/search${str ? `?${str}` : ''}`;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const isFitmentMode = Boolean(params.vehicleConfigId);
  const page = params.page ? parseInt(params.page, 10) : 1;
  const sort = params.sort || 'newest';

  const [results, facets] = await Promise.all([getResults(params), getFacets()]);
  const totalPages = Math.max(1, Math.ceil(results.total / (results.limit || 24)));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between border-b border-slate-200 pb-6 mb-6 gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {isFitmentMode ? 'Parts that fit your vehicle' : params.q ? `Results for "${params.q}"` : 'Shop All Parts'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{results.total.toLocaleString()} results found</p>
        </div>
        {!isFitmentMode && <SortSelect current={sort} />}
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters sidebar — plain links so filtering works without JS and is fully crawlable */}
        {!isFitmentMode && (facets.categories.length > 0 || facets.brands.length > 0) && (
          <aside className="lg:w-56 shrink-0 space-y-8">
            {facets.categories.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 text-sm mb-3">Category</h3>
                <ul className="space-y-1.5 text-sm">
                  {params.category && (
                    <li>
                      <Link href={buildHref(params, { category: undefined })} className="text-blue-600 hover:underline">
                        Clear filter &times;
                      </Link>
                    </li>
                  )}
                  {facets.categories.map((cat) => (
                    <li key={cat.name}>
                      <Link
                        href={buildHref(params, { category: params.category === cat.name ? undefined : cat.name })}
                        className={params.category === cat.name ? 'font-semibold text-blue-600' : 'text-slate-600 hover:text-blue-600'}
                      >
                        {cat.name} <span className="text-slate-400">({cat.count})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {facets.brands.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 text-sm mb-3">Brand</h3>
                <ul className="space-y-1.5 text-sm">
                  {params.brand && (
                    <li>
                      <Link href={buildHref(params, { brand: undefined })} className="text-blue-600 hover:underline">
                        Clear filter &times;
                      </Link>
                    </li>
                  )}
                  {facets.brands.map((b) => (
                    <li key={b.name}>
                      <Link
                        href={buildHref(params, { brand: params.brand === b.name ? undefined : b.name })}
                        className={params.brand === b.name ? 'font-semibold text-blue-600' : 'text-slate-600 hover:text-blue-600'}
                      >
                        {b.name} <span className="text-slate-400">({b.count})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}

        <div className="flex-1">
          {results.items.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-lg text-slate-600">No parts found{isFitmentMode ? ' for this vehicle configuration' : ''}.</p>
              <Link href={isFitmentMode ? '/' : '/search'} className="mt-4 inline-block text-blue-600 font-medium hover:underline">
                {isFitmentMode ? 'Try a different vehicle' : 'Clear filters'}
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {results.items.map((part) => (
                  <ProductCard key={part.id} part={part} showFitBadge={isFitmentMode} />
                ))}
              </div>

              {!isFitmentMode && totalPages > 1 && (
                <nav className="flex items-center justify-center gap-2 mt-10" aria-label="Pagination">
                  <Link
                    href={buildHref(params, { page: String(Math.max(1, page - 1)) })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border ${page <= 1 ? 'pointer-events-none text-slate-300 border-slate-100' : 'text-slate-700 border-slate-200 hover:border-blue-300'}`}
                  >
                    Previous
                  </Link>
                  <span className="text-sm text-slate-500 px-2">Page {page} of {totalPages}</span>
                  <Link
                    href={buildHref(params, { page: String(Math.min(totalPages, page + 1)) })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border ${page >= totalPages ? 'pointer-events-none text-slate-300 border-slate-100' : 'text-slate-700 border-slate-200 hover:border-blue-300'}`}
                  >
                    Next
                  </Link>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
