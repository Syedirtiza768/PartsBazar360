"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest arrivals" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export function SortSelect({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", value);
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  };

  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      <span className="hidden text-sm text-graphite-600 sm:inline">Sort</span>
      <span className="sr-only sm:hidden">Sort results</span>
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <select
          value={current}
          onChange={(e) => handleChange(e.target.value)}
          className="h-11 w-full appearance-none truncate rounded-lg border border-slate-300 bg-white pl-3.5 pr-9 text-base font-medium text-graphite-700 transition-colors hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:h-10 sm:w-auto sm:text-sm"
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </label>
  );
}
