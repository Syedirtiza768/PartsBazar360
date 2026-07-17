import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { SearchIcon } from "@repo/ui/icons";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:py-32">
      <p className="part-number text-sm font-semibold text-brand-600">Error 404</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        That part isn&apos;t on the shelf
      </h1>
      <p className="mx-auto mt-3 max-w-md text-slate-500">
        The page or listing may have been sold, removed, or the link is incorrect. Salvage
        inventory moves fast — the search usually finds an equivalent.
      </p>

      <form action="/search" className="mx-auto mt-8 max-w-md">
        <label htmlFor="nf-search" className="sr-only">
          Search parts
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
          <input
            id="nf-search"
            type="search"
            name="q"
            placeholder="Search by part name or OE number…"
            className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-24 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-8 flex items-center justify-center gap-3">
        <Link href="/search" className={buttonClasses({ variant: "outline" })}>
          Browse all parts
        </Link>
        <Link href="/" className={buttonClasses({ variant: "ghost" })}>
          Go home
        </Link>
      </div>
    </div>
  );
}
