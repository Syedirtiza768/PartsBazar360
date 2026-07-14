import Link from 'next/link';
import { INTERNAL_API_URL } from '@/lib/api';
import { VehicleSelector } from '@/components/VehicleSelector';
import { ProductCard } from '@/components/ProductCard';
import type { BrowseResponse, FacetsResponse } from '@/lib/types';

// Rendered dynamically on every request rather than cached at build time —
// the build-time container has no network route to the API, and ISR would
// otherwise bake in an empty "featured parts" snapshot until the first
// revalidation window passes.
export const dynamic = 'force-dynamic';

async function getFeaturedParts(): Promise<BrowseResponse> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?sort=newest&limit=8`, {
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], total: 0, page: 1, limit: 8 };
    return res.json();
  } catch {
    return { items: [], total: 0, page: 1, limit: 8 };
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

const VALUE_PROPS = [
  { title: 'Fitment-verified search', desc: 'Match parts to your exact make, model, generation and trim.', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { title: '11 vetted marketplace sellers', desc: 'Live inventory sourced directly from trusted global salvage & OEM sellers.', icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a4 4 0 11-8 0 4 4 0 018 0z' },
  { title: 'Worldwide shipping', desc: 'Every seller order is calculated with real, weight-based shipping.', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4M4 17h12m0 0l-4-4m4 4l-4 4' },
];

export default async function Home() {
  const [featured, facets] = await Promise.all([getFeaturedParts(), getFacets()]);

  return (
    <div>
      {/* Hero */}
      <div className="relative isolate overflow-hidden bg-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.blue.50),white)] opacity-50" />
        <div className="absolute inset-y-0 right-1/2 -z-10 mr-16 w-[200%] origin-bottom-left skew-x-[-30deg] bg-white shadow-xl shadow-blue-600/10 ring-1 ring-blue-50 sm:mr-28 lg:mr-0 xl:mr-16 xl:origin-center" />

        <div className="mx-auto max-w-7xl px-6 pb-16 pt-10 sm:pb-20 lg:flex lg:px-8 lg:py-24 items-center gap-12">
          <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-xl lg:flex-shrink-0 pt-8">
            <h1 className="mt-6 text-4xl font-black tracking-tight text-slate-900 sm:text-6xl">
              Find the exact part.<br />
              <span className="text-blue-600">Guaranteed to fit.</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Tell us what you drive, and we'll instantly filter thousands of live parts to show you only the ones that match your specific vehicle configuration.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Link href="/search" className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Or browse all parts without a vehicle
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </Link>
            </div>
          </div>

          <div className="mx-auto mt-10 max-w-xl lg:mt-0 lg:mx-0 lg:flex-shrink-0">
            <VehicleSelector />
          </div>
        </div>
      </div>

      {/* Value props */}
      <div className="border-y border-slate-100 bg-slate-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
          {VALUE_PROPS.map((prop) => (
            <div key={prop.title} className="flex items-start gap-3">
              <div className="shrink-0 bg-blue-50 text-blue-600 rounded-lg p-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={prop.icon} /></svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{prop.title}</p>
                <p className="text-sm text-slate-500 mt-0.5">{prop.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shop by category */}
      {facets.categories.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Shop by Category</h2>
          <div className="flex flex-wrap gap-2">
            {facets.categories.map((cat) => (
              <Link
                key={cat.name}
                href={`/search?category=${encodeURIComponent(cat.name)}`}
                className="px-4 py-2 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                {cat.name} <span className="text-slate-400">({cat.count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Featured / newest real listings */}
      {featured.items.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">Recently Listed Parts</h2>
            <Link href="/search" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              Browse all {featured.total.toLocaleString()} parts &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {featured.items.map((part) => (
              <ProductCard key={part.id} part={part} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
