"use client";

import { useRouter, useSearchParams } from "next/navigation";

const SIZES = [75, 150, 300];

export function PageSizeSelect({ current }: { current: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", value);
    // Changing page size resets to the first page so the range stays valid.
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  };

  return (
    <label className="flex shrink-0 items-center gap-2">
      <span className="hidden text-sm text-graphite-600 sm:inline">Per page</span>
      <span className="sr-only sm:hidden">Results per page</span>
      <div className="relative">
        <select
          value={String(current)}
          onChange={(e) => handleChange(e.target.value)}
          className="h-11 w-auto appearance-none truncate rounded-lg border border-slate-300 bg-white pl-3.5 pr-9 text-base font-medium text-graphite-700 transition-colors hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:h-10 sm:text-sm"
        >
          {SIZES.map((n) => (
            <option key={n} value={String(n)}>
              {n}
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