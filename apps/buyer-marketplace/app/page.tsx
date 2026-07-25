import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { Container } from "@repo/ui/container";
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

// Keep the route dynamic so Docker/CI builds do not require a live API, while
// still caching featured listings and facets in the Next.js Data Cache.
export const dynamic = "force-dynamic";

async function getFeaturedParts(): Promise<BrowseResponse | null> {
  try {
    const response = await fetch(`${INTERNAL_API_URL}/search/parts?sort=newest&limit=8`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function getFacets(): Promise<FacetsResponse> {
  try {
    const response = await fetch(`${INTERNAL_API_URL}/search/facets`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? response.json() : { brands: [], categories: [], makes: [] };
  } catch {
    return { brands: [], categories: [], makes: [] };
  }
}

/**
 * Section heading + trailing link. Extracted because the same pattern appeared
 * three times with three different wrap behaviours; the trailing link now
 * always drops below the heading rather than crushing it on a phone.
 */
function SectionHead({
  eyebrow,
  title,
  id,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  id?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b-2 border-graphite-950 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2
          id={id}
          className="mt-1 text-balance font-display text-2xl font-black uppercase tracking-tight text-graphite-950 sm:text-3xl"
        >
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-graphite-700">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default async function Home() {
  const [featured, facets] = await Promise.all([getFeaturedParts(), getFacets()]);

  return (
    <div>
      <section className="relative overflow-hidden border-b-2 border-graphite-950 bg-graphite-950 text-white">
        <div className="technical-grid absolute inset-0 opacity-20" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-wide gap-0 lg:grid-cols-[minmax(0,1.12fr)_500px]">
          <div className="gutter py-10 sm:py-14 lg:py-16 xl:pr-16">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-200">
              Motor parts marketplace / fitment desk
            </p>
            {/*
              Fluid display type. The old fixed ladder (text-4xl → 6xl → 7xl)
              rendered a 36px uppercase condensed headline on a 320px screen,
              which wrapped "Find the part." onto two lines and pushed the
              search field below the fold.
            */}
            <h1 className="mt-4 max-w-3xl font-display text-[clamp(2rem,1.1rem+4.5vw,4.5rem)] font-black uppercase leading-[0.94] tracking-[-0.045em] text-white">
              Find the part.
              <br />
              <span className="text-brand-300">Verify the fit.</span>
              <br />
              Know the seller.
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-[15px] leading-relaxed text-slate-300 sm:mt-6 sm:text-lg">
              Search real marketplace inventory by OE number, part name, or vehicle. Condition,
              compatibility evidence, seller terms, and shipping stay visible before you buy.
            </p>

            {/*
              The submit button stacks under the field below `xs` (380px). Side
              by side, "Find parts" plus the icon left roughly 110px for the
              input, so the placeholder was unreadable on a 320px handset.
            */}
            <form
              action="/search"
              role="search"
              className="mt-7 flex max-w-3xl flex-col gap-1 border-2 border-white bg-white p-1 text-graphite-950 xs:flex-row sm:mt-8"
            >
              <div className="flex min-w-0 flex-1 items-center">
                <SearchIcon className="ml-3 h-5 w-5 shrink-0 text-graphite-600" />
                <label htmlFor="home-search" className="sr-only">
                  Search all motor parts
                </label>
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-h-touch min-w-0 flex-1 self-stretch border-0 bg-transparent px-3 py-3 text-base font-medium outline-none placeholder:font-normal placeholder:text-graphite-600"
                  placeholder="OE number, brake caliper, BMW N47 alternator"
                />
              </div>
              <button className="min-h-touch shrink-0 bg-signal-500 px-5 text-sm font-black uppercase tracking-wide text-graphite-950 transition-colors hover:bg-signal-600">
                Find parts
              </button>
            </form>

            <ul className="mt-5 flex flex-col gap-2.5 text-xs font-semibold text-slate-300 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
              <li className="flex items-center gap-2">
                <CheckCircleIcon className="h-4 w-4 shrink-0 text-brand-300" />
                Compatibility states are evidence-based
              </li>
              <li className="flex items-center gap-2">
                <StoreIcon className="h-4 w-4 shrink-0 text-brand-300" />
                Seller identity stays visible
              </li>
              <li className="flex items-center gap-2">
                <TruckIcon className="h-4 w-4 shrink-0 text-brand-300" />
                Seller shipments stay separate
              </li>
            </ul>
          </div>

          <div className="gutter border-t-2 border-white/20 bg-canvas-sunk py-5 text-graphite-950 sm:py-6 lg:border-l-2 lg:border-t-0 lg:py-8">
            <div className="mb-5 flex items-end justify-between gap-3 border-b-2 border-graphite-950 pb-3">
              <div className="min-w-0">
                <p className="eyebrow">Vehicle-first shopping</p>
                <h2 className="mt-1 text-balance font-display text-xl font-black uppercase tracking-tight sm:text-2xl">
                  Set your fitment context
                </h2>
              </div>
              <span className="shrink-0 font-mono text-xs font-bold text-graphite-600">01—04</span>
            </div>
            <VehiclePicker variant="hero" />
          </div>
        </div>
      </section>

      <section className="border-b border-stone-300 bg-white" aria-label="Marketplace assurances">
        <div className="mx-auto grid max-w-wide sm:grid-cols-3">
          {[
            [ShieldCheckIcon, "Fitment stays visible", "Your selected vehicle follows search, listings, cart, and checkout."],
            [TagIcon, "Condition is explicit", "New, used, remanufactured, OEM, and aftermarket sources remain distinct."],
            [TruckIcon, "Seller terms stay separate", "Dispatch, returns, warranty, and seller grouping are shown before purchase."],
          ].map(([Icon, title, description], index) => {
            const ItemIcon = Icon as typeof ShieldCheckIcon;
            return (
              <div
                key={title as string}
                className="flex gap-4 border-b border-stone-300 gutter py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <span className="font-mono text-xs font-black text-signal-700">0{index + 1}</span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-graphite-950">
                    <ItemIcon className="h-4 w-4 shrink-0 text-brand-700" />
                    {title as string}
                  </p>
                  <p className="mt-1 text-pretty text-sm leading-relaxed text-graphite-700">
                    {description as string}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Container as="section" size="wide" className="py-10 lg:py-14" aria-labelledby="systems-heading">
        <SectionHead
          eyebrow="Category-first shopping"
          title="Shop by vehicle system"
          id="systems-heading"
          action={
            <Link
              href="/search"
              className="inline-flex min-h-touch items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-700 hover:text-brand-900"
            >
              All categories <ArrowRightIcon className="h-4 w-4" />
            </Link>
          }
        />
        {facets.categories.length ? (
          <div className="mt-6 grid grid-cols-2 border-l border-t border-stone-300 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {facets.categories.slice(0, 12).map((category, index) => (
              <Link
                key={category.name}
                href={`/search?category=${encodeURIComponent(category.name)}`}
                className="group flex min-h-32 min-w-0 flex-col border-b border-r border-stone-300 bg-white p-3 transition-colors hover:bg-brand-950 hover:text-white sm:p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <CategoryIcon category={category.name} className="h-6 w-6 shrink-0 text-brand-700 group-hover:text-brand-200 sm:h-7 sm:w-7" />
                  <span className="font-mono text-[10px] font-bold text-graphite-600 group-hover:text-brand-200">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-auto pt-5 font-display text-sm font-black uppercase leading-tight tracking-tight text-graphite-950 group-hover:text-white sm:text-base">
                  {category.name}
                </p>
                <p className="mt-1 text-xs tabular-nums text-graphite-600 group-hover:text-slate-300">
                  {category.count.toLocaleString()} listings
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 border border-stone-300 bg-white p-6 text-sm text-graphite-700 sm:p-8">
            Categories will return when the catalog connection is available. You can still search all
            parts.
          </div>
        )}
      </Container>

      <section className="border-y border-stone-300 bg-canvas-sunk">
        <Container size="wide" className="py-10 lg:py-14">
          <SectionHead
            eyebrow="Marketplace feed"
            title="Recently listed"
            description="Current inventory from marketplace sellers, newest first."
            action={
              featured && (
                <Link
                  href="/search"
                  className="inline-flex min-h-touch items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-700 hover:text-brand-900"
                >
                  Browse {featured.total.toLocaleString()} parts
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              )
            }
          />
          {featured === null ? (
            <div className="mt-6 border-2 border-graphite-950 bg-white p-6 text-center sm:p-8">
              <p className="font-bold text-graphite-950">The latest listings could not be loaded.</p>
              <Link href="/search" className={`${buttonClasses({ variant: "outline" })} mt-4`}>
                Open the catalog
              </Link>
            </div>
          ) : featured.items.length ? (
            <div className="mt-6 grid grid-cols-2 gap-px border border-stone-300 bg-stone-300 md:grid-cols-3 lg:grid-cols-4">
              {featured.items.map((part) => (
                <ProductCard key={part.id} part={part} />
              ))}
            </div>
          ) : (
            <div className="mt-6 border border-stone-300 bg-white p-6 text-sm text-graphite-700 sm:p-8">
              New seller inventory will appear here when listings are published.
            </div>
          )}
        </Container>
      </section>

      <Container size="wide" className="py-10">
        <RecentlyViewed />
      </Container>

      {facets.brands.length > 0 && (
        <section className="border-y-2 border-graphite-950 bg-white">
          <div className="mx-auto grid max-w-wide lg:grid-cols-[320px_1fr]">
            <div className="gutter bg-brand-950 py-8 text-white">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-200">
                Brand-first shopping
              </p>
              <h2 className="mt-2 text-balance font-display text-2xl font-black uppercase tracking-tight sm:text-3xl">
                Know the badge?
                <br />
                Start there.
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {facets.brands.slice(0, 12).map((brand) => (
                <Link
                  key={brand.name}
                  href={`/search?brand=${encodeURIComponent(brand.name)}`}
                  className="flex min-h-20 min-w-0 items-center justify-between gap-2 border-b border-r border-stone-300 px-3 py-3 text-sm font-black uppercase tracking-wide text-slate-800 hover:bg-stone-100 sm:px-4"
                >
                  {/* Long marques (MERCEDES-BENZ, LAND ROVER) previously ran
                      straight out of a 160px cell at 320px. */}
                  <span className="min-w-0 break-anywhere">{brand.name}</span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-graphite-600">
                    {brand.count.toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <Container
        as="section"
        size="wide"
        className="grid gap-8 py-12 lg:grid-cols-[1fr_1.4fr] lg:py-16"
      >
        <div>
          <p className="eyebrow">The parts-buying loop</p>
          <h2 className="mt-2 text-balance font-display text-2xl font-black uppercase leading-tight tracking-tight text-graphite-950 sm:text-4xl">
            Search once.
            <br />
            Carry fitment through checkout.
          </h2>
          <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-graphite-700">
            The marketplace keeps the same decision order experienced Motors buyers expect: vehicle,
            listing, fitment, condition, seller, delivery, returns, purchase, tracking, and support.
          </p>
        </div>
        <ol className="border-t-2 border-graphite-950">
          {[
            [CarIcon, "Save a vehicle", "Choose make, model, generation, and engine. Switch vehicles without losing your search."],
            [SearchIcon, "Compare compatible listings", "Filter the catalog, inspect condition and part numbers, then compare seller terms."],
            [CheckCircleIcon, "Verify before purchase", "Fitment status follows the item into cart and checkout, including uncertainty warnings."],
            [StoreIcon, "Manage each seller order", "Seller shipments remain separate, with support, returns, and issue reporting tied to the purchase."],
          ].map(([Icon, title, description], index) => {
            const StepIcon = Icon as typeof CarIcon;
            return (
              <li
                key={title as string}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-stone-300 py-5 sm:grid-cols-[56px_190px_minmax(0,1fr)] sm:gap-x-4"
              >
                <span className="font-mono text-xs font-black text-signal-700">0{index + 1}</span>
                <p className="flex min-w-0 items-center gap-2 font-display text-[15px] font-black uppercase text-graphite-950 sm:text-base">
                  <StepIcon className="h-5 w-5 shrink-0 text-brand-700" />
                  {title as string}
                </p>
                <p className="col-start-2 text-pretty text-sm leading-relaxed text-graphite-700 sm:col-start-3">
                  {description as string}
                </p>
              </li>
            );
          })}
        </ol>
      </Container>
    </div>
  );
}
