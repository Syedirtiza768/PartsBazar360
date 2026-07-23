"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClasses, Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { BoxIcon, CheckIcon } from "@repo/ui/icons";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
import { PartThumbnail } from "@/components/PartThumbnail";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

interface InventoryItem {
  id: string;
  condition: string;
  price: number;
  sellerBasePrice?: number | null;
  marketplaceFee?: number | null;
  sellerProceeds?: number | null;
  currency: string;
  status: string;
  inventory: { quantity: number }[];
  canonicalPart?: { title?: string; imageUrls?: string[] };
}

/** Inline price editor with explicit save + feedback (replaces silent onBlur commit). */
function PriceEditor({
  item,
  onSaved,
}: {
  item: InventoryItem;
  onSaved: (updated: InventoryItem) => void;
}) {
  const initial = item.sellerBasePrice ?? item.price;
  const [value, setValue] = useState(String(initial));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const dirty = parseFloat(value) !== initial && value.trim() !== "";

  const save = async () => {
    const price = parseFloat(value);
    if (Number.isNaN(price) || price <= 0) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/inventory/${item.id}?sellerId=${DEMO_SELLER_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error();
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`price-${item.id}`}>
          Base price for {item.canonicalPart?.title || "part"}
        </label>
        <input
          id={`price-${item.id}`}
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) save();
          }}
          aria-invalid={error || undefined}
          className={`w-24 rounded-lg border px-2.5 py-1.5 text-sm tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            error ? "border-red-400" : "border-slate-300 hover:border-slate-400"
          }`}
        />
        {dirty && (
          <Button size="sm" variant="secondary" onClick={save} loading={saving}>
            Save
          </Button>
        )}
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <CheckIcon className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          Enter a valid price
        </p>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const loading = inventory === null && !error;

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/inventory?sellerId=${DEMO_SELLER_ID}&page=1&limit=50`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setInventory(data);
        else if (Array.isArray(data?.items)) setInventory(data.items);
        else setInventory([]);
      })
      .catch(() => setError(true));
  }, []);

  const replaceItem = (updated: InventoryItem) => {
    setInventory((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Catalog control"
        title="Inventory management"
        description="Manage pricing, stock levels, listing status, and product quality. Edit the base price — buyer price and your proceeds update from your pricing policy."
        actions={
          <Link href="/uploads" className={buttonClasses()}>
            Import CSV
          </Link>
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          Couldn&apos;t load inventory. Refresh to try again.
        </div>
      ) : loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-xl" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : inventory!.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<BoxIcon />}
          title="No inventory yet"
          description="Upload a CSV of listings to start selling — rows that pass validation become live offers."
        >
          <Link href="/uploads" className={buttonClasses()}>
            Upload listings
          </Link>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3.5 sm:px-5" colSpan={2}>
                    Part
                  </th>
                  <th className="px-4 py-3.5">Condition</th>
                  <th className="px-4 py-3.5">Base price</th>
                  <th className="px-4 py-3.5">Buyer price</th>
                  <th className="px-4 py-3.5">Your proceeds</th>
                  <th className="px-4 py-3.5">Stock</th>
                  <th className="px-4 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory!.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="w-16 py-3 pl-4 sm:pl-5">
                      <PartThumbnail src={item.canonicalPart?.imageUrls?.[0]} alt="" />
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <p className="line-clamp-2 font-medium leading-snug text-slate-900">
                        {item.canonicalPart?.title || "Unknown part"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.condition} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <PriceEditor item={item} onSaved={replaceItem} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="price text-sm">
                        {item.currency} {Number(item.price).toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Fee {item.currency} {Number(item.marketplaceFee || 0).toFixed(2)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="price text-sm text-emerald-700">
                        {item.currency} {Number(item.sellerProceeds ?? item.price).toFixed(2)}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {item.inventory?.[0]?.quantity ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
