"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@repo/ui/badge";
import {
  ShieldCheckIcon,
  AlertTriangleIcon,
  SearchIcon,
  InfoIcon,
} from "@repo/ui/icons";
import type { CompatibilityRow, CompatibleVehicle } from "@/lib/types";

/**
 * Vehicle compatibility with honest evidence separation:
 *  1. Verified fitment (structured A/B evidence ≥ 0.8) — green, prominent.
 *  2. Advisory matches (title-inferred / low confidence) — amber, clearly
 *     labeled as requiring confirmation.
 *  3. The full per-year table, with its source labeled per row.
 * Uncertain data is never dressed up as verified.
 */

const VERIFIED_LEVELS = new Set(["A", "B"]);

export function CompatibilitySection({
  rows,
  compatibleVehicles = [],
}: {
  rows: CompatibilityRow[];
  compatibleVehicles?: CompatibleVehicle[];
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const verified = compatibleVehicles.filter(
    (v) => VERIFIED_LEVELS.has((v.evidenceLevel || "").toUpperCase()) && Number(v.confidence || 0) >= 0.8,
  );
  const advisory = compatibleVehicles.filter((v) => !verified.includes(v));

  const tableRows = useMemo(() => {
    if (rows.length > 0) return rows;
    // Fall back to expanding fitment year ranges when no structured rows exist.
    const out: CompatibilityRow[] = [];
    for (const v of compatibleVehicles) {
      if (!v.startYear || !v.endYear) continue;
      const from = Math.min(v.startYear, v.endYear);
      const to = Math.max(v.startYear, v.endYear);
      for (let year = from; year <= Math.min(to, from + 40); year++) {
        out.push({ year, make: v.make, model: v.model, trim: "-", engine: "-", source: "title" });
      }
    }
    return out;
  }, [rows, compatibleVehicles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tableRows;
    return tableRows.filter((r) =>
      [r.year, r.make, r.model, r.trim, r.engine].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [tableRows, query]);

  const visible = showAll ? filtered : filtered.slice(0, 10);
  const hasAnything = verified.length > 0 || advisory.length > 0 || tableRows.length > 0;

  return (
    <section aria-labelledby="compatibility-heading" className="space-y-4">
      <h2 id="compatibility-heading" className="text-lg font-bold tracking-tight text-slate-900">
        Vehicle compatibility
      </h2>

      {!hasAnything ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-900">No compatibility data yet</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              This listing has no structured fitment information. Match the OE number against your
              vehicle&apos;s parts catalog, or ask support to verify before ordering.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Verified fitment */}
          {verified.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
                Verified fitment — high-confidence structured evidence
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {verified.map((v, i) => (
                  <li key={`${v.label}-${i}`}>
                    <Link
                      href={`/search?q=${encodeURIComponent(`${v.make} ${v.model}`)}`}
                      className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-3 py-1 text-sm font-medium text-emerald-900 transition-colors hover:border-emerald-400 hover:bg-emerald-100"
                    >
                      {v.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advisory matches */}
          {advisory.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangleIcon className="h-4 w-4 text-amber-600" />
                Possible matches — confirm before ordering
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                Inferred from the listing title or low-confidence data. Confirm the exact trim,
                engine, and OE number first.
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {advisory.map((v, i) => (
                  <li key={`${v.label}-adv-${i}`}>
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-white px-3 py-1 text-sm text-amber-900">
                      {v.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-year table */}
          {tableRows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Compatibility table
                    <span className="ml-2 font-normal text-graphite-600">
                      {filtered.length} vehicle{filtered.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                </div>
                <div className="relative sm:w-72">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by year, make, model…"
                    aria-label="Filter compatibility table"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-graphite-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {["Year", "Make", "Model", "Trim", "Engine", "Source"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-graphite-600"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-graphite-600">
                          No vehicles match “{query}”.
                        </td>
                      </tr>
                    ) : (
                      visible.map((item, i) => (
                        <tr key={`${item.year}-${item.make}-${item.model}-${i}`} className={i % 2 === 1 ? "bg-slate-50/60" : undefined}>
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium tabular-nums text-slate-900">
                            {item.year || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{item.make || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{item.model || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{item.trim || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{item.engine || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            {item.mvlVerified === true ? (
                              <Badge tone="success" size="sm">
                                MVL verified
                              </Badge>
                            ) : item.mvlVerified === false ? (
                              <Badge tone="warning" size="sm">
                                Unverified
                              </Badge>
                            ) : item.source === "title" ? (
                              <Badge tone="warning" size="sm">
                                Title-inferred
                              </Badge>
                            ) : (
                              <Badge tone="neutral" size="sm">
                                {item.notes || item.source || "Listing fitment"}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {filtered.length > 10 && (
                <div className="border-t border-slate-200 px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
                  >
                    {showAll ? "Show fewer vehicles" : `Show all ${filtered.length} vehicles`}
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            Compatibility data comes from structured seller fitment and listing metadata. When in
            doubt, the OE number is the ground truth — match it against your vehicle&apos;s parts
            catalog or ask our team.
          </p>
        </>
      )}
    </section>
  );
}
