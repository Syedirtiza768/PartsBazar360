"use client";

import { useMemo, useState } from 'react';

export interface CompatibilityRow {
  year: number | string;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  notes?: string;
  source?: string;
}

export function CompatibilityTable({
  rows,
  compatibleVehicles = [],
}: {
  rows: CompatibilityRow[];
  compatibleVehicles?: Array<{ label: string; make: string; model: string; startYear: number | null; endYear: number | null }>;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const expanded = useMemo(() => {
    if (rows.length > 0) return rows;
    // Fallback: expand year ranges from compatibleVehicles
    const out: CompatibilityRow[] = [];
    for (const v of compatibleVehicles) {
      if (!v.startYear || !v.endYear) continue;
      const from = Math.min(v.startYear, v.endYear);
      const to = Math.max(v.startYear, v.endYear);
      for (let year = from; year <= Math.min(to, from + 40); year++) {
        out.push({ year, make: v.make, model: v.model, trim: '-', engine: '-', source: 'title' });
      }
    }
    return out;
  }, [rows, compatibleVehicles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expanded;
    return expanded.filter((r) =>
      [r.year, r.make, r.model, r.trim, r.engine]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [expanded, query]);

  const visible = showAll ? filtered : filtered.slice(0, 12);

  if (expanded.length === 0) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
        No vehicle compatibility table is available for this listing yet. Check the title/OE numbers or contact the seller.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Vehicle Compatibility</h2>
          <p className="text-xs text-slate-500">
            eBay-style fitment list · {filtered.length} vehicle{filtered.length === 1 ? '' : 's'}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by year, make, model..."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-72"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Year</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Make</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Model</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Trim</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Engine</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((item, i) => (
              <tr key={`${item.year}-${item.make}-${item.model}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                <td className="px-4 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">{item.year || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-800 whitespace-nowrap">{item.make || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-800 whitespace-nowrap">{item.model || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{item.trim || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{item.engine || '-'}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {item.source === 'title' ? 'From listing title' : item.notes || item.source || 'eBay fitment'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 12 && (
        <div className="border-t border-slate-200 px-4 py-3 text-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            {showAll ? 'Show fewer vehicles' : `Show all ${filtered.length} vehicles`}
          </button>
        </div>
      )}
    </div>
  );
}
