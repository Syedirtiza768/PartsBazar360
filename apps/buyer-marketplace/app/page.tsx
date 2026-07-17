import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import {
  ShieldCheckIcon,
  TruckIcon,
  SearchIcon,
  CarIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  StoreIcon,
  TagIcon,
} from "@repo/ui/icons";
import { INTERNAL_API_URL } from "@/lib/api";
import { VehiclePicker } from "@/components/VehiclePicker";
import { ProductCard } from "@/components/ProductCard";
import { CategoryIcon } from "@/components/CategoryIcon";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import type { BrowseResponse, FacetsResponse } from "@/lib/types";

// Rendered dynamically on every request rather than cached at build time —
// the build-time container has no network route to the API, and ISR would
// otherwise bake in an empty "featured parts" snapshot until the first
// revalidation window passes.
export const dynamic = "force-dynamic";

// null = fetch failed (show error state); empty items = genuinely empty.
async function getFeaturedParts(): Promise<BrowseResponse | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts?sort=newest&limit=8`, {
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
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, { cache: "no-store" });
    if (!res.ok) return { brands: [], categories: [] };
    return res.json();
  } catch {
    return { brands: [], categories: [] };
  }
}

const HOW_IT_WORKS = [
  {
    icon: <CarIcon className="h-6 w-6" />,
    title: "Tell us what you drive",
    desc: "Pick your make, model, generation, and engine once — we remember it in your garage.",
  },
  {
    icon: <SearchIcon className="h-6 w-6" />,
    title: "See only what fits",
    desc: "Search results are filtered to your exact configuration, with the fitment evidence shown on every listing.",
  },
  {
    icon: <CheckCircleIcon className="h-6 w-6" />,
    title: "Order with confidence",
    desc: "Condition, source, seller, and returns are disclosed up front. Our team verifies fitment questions before you commit.",
  },
];

export default async function Home() {
  const [featured, facets] = await Promise.all([getFeaturedParts(), getFacets()]);
  const categories = facets.categories;

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-graphite-950">
        {/* Subtle engineering-grid texture */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(148 163 184 / 0.09) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.09) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute -top-40 right-[-10%] -z-10 h-[480px] w-[640px] rounded-full bg-brand-600/20 blur-[140px]"
        />

        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[1fr_460px] lg:gap-16 lg:px-8 lg:pb-20 lg:pt-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-slate-200">
              <ShieldCheckIcon className="h-4 w-4 text-emerald-400" />
              Every listing shows its fitment evidence
            </p>
            <h1 className="mt-5 text-display-sm font-black text-white sm:text-display lg:text-display-lg">
              The right part for your <span className="text-brand-400">exact vehicle.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Live inventory from vetted salvage and OEM sellers worldwide — filtered to your
              make, model, generation, and engine, with condition and compatibility disclosed
              before you buy.
            </p>

            <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4">
              {[
                { value: featured ? `${featured.total.toLocaleString()}+` : "10,000+", label: "Live parts" },
                { value: "11", label: "Vetted sellers" },
                { value: "A–F", label: "Fitment evidence grading" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-xl font-bold tabular-nums text-white sm:text-2xl">{stat.value}</dd>
                  <dd className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-8">
              <Link
                href="/search"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
              >
                Or browse the full catalog without a vehicle
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <VehiclePicker variant="hero" />
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────── */}
      <section aria-label="Why buy here" className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-slate-100 px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 lg:px-8">
          {[
            {
              icon: <ShieldCheckIcon className="h-5 w-5" />,
              title: "Fitment-verified search",
              desc: "Vehicle search returns only parts with high-confidence compatibility evidence.",
            },
            {
              icon: <TagIcon className="h-5 w-5" />,
              title: "Condition disclosed",
              desc: "New, used, refurbished, OEM or aftermarket — labeled on every card.",
            },
            {
              icon: <TruckIcon className="h-5 w-5" />,
              title: "Worldwide shipping",
              desc: "Real, weight-based rates calculated per seller at checkout.",
            },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3.5 py-5 sm:px-6 sm:first:pl-0 sm:last:pr-0">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                {item.icon}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      {categories.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-labelledby="categories-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="categories-heading" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                Shop by category
              </h2>
              <p className="mt-1 text-sm text-slate-500">Jump straight to the system you&apos;re working on.</p>
            </div>
            <Link
              href="/search"
              className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700 sm:inline-flex"
            >
              All parts <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {categories.slice(0, 12).map((cat) => (
              <li key={cat.name}>
                <Link
                  href={`/search?category=${encodeURIComponent(cat.name)}`}
                  className="group flex flex-col items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-5 text-center shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600">
                    <CategoryIcon category={cat.name} className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">
                    {cat.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Recently listed ──────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8" aria-labelledby="recent-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-heading" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Recently listed parts
            </h2>
            <p className="mt-1 text-sm text-slate-500">Fresh inventory from marketplace sellers.</p>
          </div>
          {featured && featured.total > 0 && (
            <Link
              href="/search"
              className="shrink-0 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
            >
              Browse all {featured.total.toLocaleString()} parts →
            </Link>
          )}
        </div>

        <div className="mt-6">
          {featured === null ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">We couldn&apos;t load the latest listings.</p>
              <p className="mt-1 text-sm text-slate-500">The catalog is still available.</p>
              <Link href="/search" className={`${buttonClasses({ variant: "outline", size: "sm" })} mt-4`}>
                Open the catalog
              </Link>
            </div>
          ) : featured.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
              New listings will appear here as sellers publish inventory.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {featured.items.map((part) => (
                <ProductCard key={part.id} part={part} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Recently viewed (device-local) ───────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <RecentlyViewed />
      </div>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="border-y border-slate-200 bg-white" aria-labelledby="how-heading">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 id="how-heading" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Built around one question: does it fit?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">
              Auto parts are unforgiving — one digit off an OE number and the part doesn&apos;t bolt on.
              PartsBazar360 structures every listing around compatibility evidence.
            </p>
          </div>
          <ol className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={step.title} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-6">
                <span className="absolute right-5 top-5 text-4xl font-black tabular-nums text-slate-200" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 text-white">
                  {step.icon}
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Seller trust band ────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8" aria-labelledby="sellers-heading">
        <div className="flex flex-col items-start justify-between gap-8 rounded-2xl bg-graphite-950 p-8 sm:p-10 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <StoreIcon className="h-4 w-4" /> Verified inventory
            </p>
            <h2 id="sellers-heading" className="mt-3 text-xl font-bold text-white sm:text-2xl">
              Sourced live from 11 vetted marketplace sellers
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Every seller passes business verification and agrees to marketplace terms covering
              fulfilment SLAs, returns, and accurate condition grading. Listings sync directly
              from their live inventory — no stale stock.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href="/search" className={buttonClasses({ variant: "primary", size: "lg" })}>
              Start shopping
            </Link>
            <Link
              href="/support"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/20 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Ask a question
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
