import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import {
  ArrowRightIcon,
  CarIcon,
  CheckCircleIcon,
  SearchIcon,
  ShieldCheckIcon,
  StoreIcon,
  TagIcon,
  TruckIcon,
} from "@repo/ui/icons";
import { INTERNAL_API_URL } from "@/lib/api";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProductCard } from "@/components/ProductCard";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { VehiclePicker } from "@/components/VehiclePicker";
import type { BrowseResponse, FacetsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

async function getFeaturedParts(): Promise<BrowseResponse | null> {
  try {
    const response = await fetch(`${INTERNAL_API_URL}/search/parts?sort=newest&limit=8`, { cache: "no-store" });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function getFacets(): Promise<FacetsResponse> {
  try {
    const response = await fetch(`${INTERNAL_API_URL}/search/facets`, { cache: "no-store" });
    return response.ok ? response.json() : { brands: [], categories: [] };
  } catch {
    return { brands: [], categories: [] };
  }
}

export default async function Home() {
  const [featured, facets] = await Promise.all([getFeaturedParts(), getFacets()]);

  return (
    <div>
      <section className="relative overflow-hidden border-b-2 border-slate-950 bg-graphite-950 text-white">
        <div className="technical-grid absolute inset-0 opacity-20" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-[1440px] gap-0 lg:grid-cols-[minmax(0,1.12fr)_500px]">
          <div className="px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16 xl:pr-16">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-200">Motor parts marketplace / fitment desk</p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl font-black uppercase leading-[0.94] tracking-[-0.045em] text-white sm:text-6xl xl:text-7xl">
              Find the part.<br /><span className="text-brand-300">Verify the fit.</span><br />Know the seller.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Search real marketplace inventory by OE number, part name, or vehicle. Condition, compatibility evidence, seller terms, and shipping stay visible before you buy.
            </p>

            <form action="/search" role="search" className="mt-8 flex max-w-3xl border-2 border-white bg-white p-1 text-slate-950">
              <SearchIcon className="ml-3 mt-3 h-5 w-5 shrink-0 text-graphite-600" />
              <label htmlFor="home-search" className="sr-only">Search all motor parts</label>
              <input id="home-search" name="q" className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2.5 text-base font-medium outline-none placeholder:font-normal placeholder:text-graphite-600" placeholder="Try an OE number, brake caliper, or BMW N47 alternator" />
              <button className="bg-signal-500 px-5 text-sm font-black uppercase tracking-wide text-graphite-950 hover:bg-signal-600">Find parts</button>
            </form>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-2"><CheckCircleIcon className="h-4 w-4 text-brand-300" />Compatibility states are evidence-based</span>
              <span className="flex items-center gap-2"><StoreIcon className="h-4 w-4 text-brand-300" />Seller identity stays visible</span>
              <span className="flex items-center gap-2"><TruckIcon className="h-4 w-4 text-brand-300" />Seller shipments stay separate</span>
            </div>
          </div>

          <div className="border-t-2 border-white/20 bg-[#e9e5dc] p-4 text-slate-950 sm:p-6 lg:border-l-2 lg:border-t-0 lg:border-white/20 lg:p-8">
            <div className="mb-5 flex items-end justify-between border-b-2 border-slate-950 pb-3">
              <div>
                <p className="eyebrow">Vehicle-first shopping</p>
                <h2 className="mt-1 font-display text-2xl font-black uppercase tracking-tight">Set your fitment context</h2>
              </div>
              <span className="font-mono text-xs font-bold text-graphite-600">01—04</span>
            </div>
            <VehiclePicker variant="hero" />
          </div>
        </div>
      </section>

      <section className="border-b border-stone-300 bg-white" aria-label="Marketplace assurances">
        <div className="mx-auto grid max-w-[1440px] sm:grid-cols-3">
          {[
            [ShieldCheckIcon, "Fitment stays visible", "Your selected vehicle follows search, listings, cart, and checkout."],
            [TagIcon, "Condition is explicit", "New, used, remanufactured, OEM, and aftermarket sources remain distinct."],
            [TruckIcon, "Seller terms stay separate", "Dispatch, returns, warranty, and seller grouping are shown before purchase."],
          ].map(([Icon, title, description], index) => {
            const ItemIcon = Icon as typeof ShieldCheckIcon;
            return (
              <div key={title as string} className="flex gap-4 border-b border-stone-300 px-4 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-6 lg:px-8">
                <span className="font-mono text-xs font-black text-signal-700">0{index + 1}</span>
                <div>
                  <p className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-950"><ItemIcon className="h-4 w-4 text-brand-700" />{title as string}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{description as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14" aria-labelledby="systems-heading">
        <div className="flex items-end justify-between border-b-2 border-slate-950 pb-4">
          <div>
            <p className="eyebrow">Category-first shopping</p>
            <h2 id="systems-heading" className="mt-1 font-display text-2xl font-black uppercase tracking-tight text-slate-950 sm:text-3xl">Shop by vehicle system</h2>
          </div>
          <Link href="/search" className="hidden items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-700 hover:text-brand-900 sm:flex">All categories <ArrowRightIcon className="h-4 w-4" /></Link>
        </div>
        {facets.categories.length ? (
          <div className="grid grid-cols-2 border-l border-t border-stone-300 sm:grid-cols-3 lg:grid-cols-6">
            {facets.categories.slice(0, 12).map((category, index) => (
              <Link key={category.name} href={`/search?category=${encodeURIComponent(category.name)}`} className="group min-h-32 border-b border-r border-stone-300 bg-white p-4 transition-colors hover:bg-brand-950 hover:text-white">
                <div className="flex items-start justify-between">
                  <CategoryIcon category={category.name} className="h-7 w-7 text-brand-700 group-hover:text-brand-200" />
                  <span className="font-mono text-[10px] font-bold text-graphite-600 group-hover:text-brand-200">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <p className="mt-6 font-display text-base font-black uppercase leading-tight tracking-tight text-slate-950 group-hover:text-white">{category.name}</p>
                <p className="mt-1 text-xs tabular-nums text-graphite-600 group-hover:text-slate-300">{category.count.toLocaleString()} listings</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="border border-stone-300 bg-white p-8 text-sm text-slate-600">Categories will return when the catalog connection is available. You can still search all parts.</div>
        )}
      </section>

      <section className="border-y border-stone-300 bg-[#e9e5dc]">
        <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="flex items-end justify-between border-b-2 border-slate-950 pb-4">
            <div>
              <p className="eyebrow">Marketplace feed</p>
              <h2 className="mt-1 font-display text-2xl font-black uppercase tracking-tight text-slate-950 sm:text-3xl">Recently listed</h2>
              <p className="mt-1 text-sm text-slate-600">Current inventory from marketplace sellers, newest first.</p>
            </div>
            {featured && <Link href="/search" className="text-sm font-black uppercase tracking-wide text-brand-700">Browse {featured.total.toLocaleString()} parts →</Link>}
          </div>
          {featured === null ? (
            <div className="mt-6 border-2 border-slate-950 bg-white p-8 text-center"><p className="font-bold text-slate-950">The latest listings could not be loaded.</p><Link href="/search" className={`${buttonClasses({ variant: "outline" })} mt-4`}>Open the catalog</Link></div>
          ) : featured.items.length ? (
            <div className="mt-6 grid grid-cols-2 gap-px border border-stone-300 bg-stone-300 md:grid-cols-3 lg:grid-cols-4">
              {featured.items.map((part) => <ProductCard key={part.id} part={part} />)}
            </div>
          ) : (
            <div className="mt-6 border border-stone-300 bg-white p-8 text-sm text-slate-600">New seller inventory will appear here when listings are published.</div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8"><RecentlyViewed /></div>

      {facets.brands.length > 0 && (
        <section className="border-y-2 border-slate-950 bg-white">
          <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[320px_1fr]">
            <div className="bg-brand-950 px-4 py-8 text-white sm:px-6 lg:px-8">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-200">Brand-first shopping</p>
              <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight">Know the badge?<br />Start there.</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {facets.brands.slice(0, 12).map((brand) => (
                <Link key={brand.name} href={`/search?brand=${encodeURIComponent(brand.name)}`} className="flex min-h-20 items-center justify-between border-b border-r border-stone-300 px-4 text-sm font-black uppercase tracking-wide text-slate-800 hover:bg-stone-100">
                  {brand.name}<span className="font-mono text-[10px] tabular-nums text-graphite-600">{brand.count.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-[1440px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-8 lg:py-16">
        <div>
          <p className="eyebrow">The parts-buying loop</p>
          <h2 className="mt-2 font-display text-3xl font-black uppercase leading-tight tracking-tight text-slate-950 sm:text-4xl">Search once.<br />Carry fitment through checkout.</h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-600">The marketplace keeps the same decision order experienced Motors buyers expect: vehicle, listing, fitment, condition, seller, delivery, returns, purchase, tracking, and support.</p>
        </div>
        <ol className="border-t-2 border-slate-950">
          {[
            [CarIcon, "Save a vehicle", "Choose make, model, generation, and engine. Switch vehicles without losing your search."],
            [SearchIcon, "Compare compatible listings", "Filter the catalog, inspect condition and part numbers, then compare seller terms."],
            [CheckCircleIcon, "Verify before purchase", "Fitment status follows the item into cart and checkout, including uncertainty warnings."],
            [StoreIcon, "Manage each seller order", "Seller shipments remain separate, with support, returns, and issue reporting tied to the purchase."],
          ].map(([Icon, title, description], index) => {
            const StepIcon = Icon as typeof CarIcon;
            return <li key={title as string} className="grid grid-cols-[40px_1fr] gap-4 border-b border-stone-300 py-5 sm:grid-cols-[56px_190px_1fr]"><span className="font-mono text-xs font-black text-signal-700">0{index + 1}</span><p className="flex items-center gap-2 font-display text-base font-black uppercase text-slate-950"><StepIcon className="h-5 w-5 text-brand-700" />{title as string}</p><p className="col-start-2 text-sm leading-relaxed text-slate-600 sm:col-start-3">{description as string}</p></li>;
          })}
        </ol>
      </section>
    </div>
  );
}
