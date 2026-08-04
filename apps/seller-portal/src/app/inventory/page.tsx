"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClasses, Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { DataTable, type Column } from "@repo/ui/data-table";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { BoxIcon, CheckIcon } from "@repo/ui/icons";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { useSellerAuth } from "@/lib/auth-context";
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
  const { token, sellerId } = useSellerAuth();
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
      const res = await apiFetch(token, `${API_BASE_URL}/merchant/inventory/${item.id}?sellerId=${sellerId}`, {
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
    <div className="min-w-0">
      {/* Wraps rather than overflowing: in the mobile card this control shares
          a row with its label, so it can be as narrow as ~9rem. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`price-${item.id}`}>
          Base price for {item.canonicalPart?.title || "part"}
        </label>
        <input
          id={`price-${item.id}`}
          type="number"
          min="0"
          step="0.01"
          // Brings up the numeric keypad with a decimal point on both platforms.
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) save();
          }}
          aria-invalid={error || undefined}
          className={`w-24 min-h-touch rounded-lg border px-2.5 py-1.5 text-base tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 sm:min-h-0 sm:text-sm ${
            error ? "border-red-400" : "border-slate-300 hover:border-slate-400"
          }`}
        />
        {dirty && (
          <Button size="sm" variant="secondary" onClick={save} loading={saving}>
            Save
          </Button>
        )}
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
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
  const { token, sellerId } = useSellerAuth();
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const loading = inventory === null && !error;

  useEffect(() => {
    if (!sellerId) return;
    apiFetch(token, `${API_BASE_URL}/merchant/inventory?sellerId=${sellerId}&page=1&limit=50`)
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
  }, [token, sellerId]);

  const replaceItem = (updated: InventoryItem) => {
    setInventory((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
  };

  const money = (amount: number | null | undefined, currency: string) =>
    `${currency} ${Number(amount ?? 0).toFixed(2)}`;

  /*
   * One definition drives both presentations. Below `lg` each row becomes a
   * card whose heading is the part (thumbnail + title), with condition/status
   * on the meta line and the money columns as labelled fields — so the price
   * editor stays usable at 320px instead of sitting 700px off-screen inside a
   * `min-w-[880px]` table.
   */
  const columns: Column<InventoryItem>[] = [
    {
      key: "part",
      header: "Part",
      priority: "primary",
      cell: (item) => (
        <div className="flex min-w-0 items-center gap-3">
          <PartThumbnail src={item.canonicalPart?.imageUrls?.[0]} alt="" />
          <p className="line-clamp-2 min-w-0 font-medium leading-snug text-slate-900">
            {item.canonicalPart?.title || "Unknown part"}
          </p>
        </div>
      ),
    },
    {
      key: "condition",
      header: "Condition",
      priority: "secondary",
      cell: (item) => <StatusBadge status={item.condition} size="sm" />,
    },
    {
      key: "status",
      header: "Status",
      priority: "secondary",
      cell: (item) => <StatusBadge status={item.status} size="sm" />,
    },
    {
      key: "basePrice",
      header: "Base price",
      cell: (item) => <PriceEditor item={item} onSaved={replaceItem} />,
    },
    {
      key: "buyerPrice",
      header: "Buyer price",
      cell: (item) => (
        <>
          <p className="price text-sm">{money(item.price, item.currency)}</p>
          <p className="text-xs text-graphite-600">
            Fee {money(item.marketplaceFee, item.currency)}
          </p>
        </>
      ),
    },
    {
      key: "proceeds",
      header: "Your proceeds",
      cell: (item) => (
        <p className="price text-sm text-emerald-700">
          {money(item.sellerProceeds ?? item.price, item.currency)}
        </p>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      cell: (item) => (
        <span className="tabular-nums text-slate-700">{item.inventory?.[0]?.quantity ?? 0}</span>
      ),
    },
  ];

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
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
            <Skeleton key={i} className="h-24 w-full rounded-xl lg:h-16" />
          ))}
        </div>
      ) : (
        <DataTable
          caption="Inventory listings"
          rows={inventory!}
          columns={columns}
          getRowKey={(item) => item.id}
          tableFrom="lg"
          empty={
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
          }
        />
      )}
    </PageBody>
  );
}
