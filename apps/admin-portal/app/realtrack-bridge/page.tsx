"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/field";
import { PageHeader, StatCard, StatGrid } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

interface BridgeItem {
  offerId: string;
  sku: string;
  title: string;
  seller?: { id: string; name: string };
  sellerSku?: string | null;
  sourceTag?: string | null;
  cost: number;
  currency: string;
  targetCurrency: string;
  sellingPrice: number | null;
  quantity: number;
  imageCount: number;
  skipReason: string | null;
  skipDetail: string | null;
}

interface BridgeListResponse {
  total: number;
  sourceCurrency: string;
  targetCurrency: string;
  items: BridgeItem[];
}

interface TransferResponse {
  dryRun: boolean;
  counts?: {
    selected: number;
    eligible: number;
    transferred?: number;
    skipped: number;
    transferFailed?: number;
    published?: number;
  };
  results?: Array<{
    offerId: string;
    status: string;
    remoteListingId?: string;
    sellingPrice?: number | null;
    error?: string;
    publishStatus?: string;
    publishError?: string;
  }>;
}

const skipLabels: Record<string, string> = {
  below_minimum: "Below $5",
  currency_mismatch: "Currency mismatch",
  no_inventory: "No inventory",
  inactive_offer: "Inactive",
  invalid_cost: "Invalid cost",
};

export default function RealtrackBridgePage() {
  const { token } = useAdminAuth();
  const [sourceCurrency, setSourceCurrency] = useState("USD");
  const [targetCurrency, setTargetCurrency] = useState("USD");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<BridgeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [publishToEbay, setPublishToEbay] = useState(false);
  const [storeIds, setStoreIds] = useState("");
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResponse | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "100",
        sourceCurrency: sourceCurrency.trim().toUpperCase(),
        targetCurrency: targetCurrency.trim().toUpperCase(),
      });
      if (search.trim()) params.set("search", search.trim());
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/admin/realtrack-bridge/offers?${params}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || "Could not load PartsBazar offers.");
      const data = body as BridgeListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total || 0);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not load bridge offers.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Loading on first authenticated render is intentional; the controls use Refresh for subsequent changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const eligibleItems = useMemo(
    () => items.filter((item) => !item.skipReason),
    [items],
  );

  const toggleSelected = (offerId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(offerId)) next.delete(offerId);
      else next.add(offerId);
      return next;
    });
  };

  const selectEligible = () => {
    setSelected(new Set(eligibleItems.map((item) => item.offerId)));
  };

  const transfer = async () => {
    if (!token || selected.size === 0) {
      setError("Select at least one offer to transfer.");
      return;
    }
    if (publishToEbay && !storeIds.trim()) {
      setError(
        "Enter at least one RealTrack store ID before enabling eBay publish.",
      );
      return;
    }

    setTransferring(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/admin/realtrack-bridge/transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerIds: Array.from(selected),
            sourceCurrency: sourceCurrency.trim().toUpperCase(),
            targetCurrency: targetCurrency.trim().toUpperCase(),
            includeOutOfStock,
            dryRun: false,
            publishToEbay,
            storeIds: storeIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || "RealTrack transfer failed.");
      setResult(body as TransferResponse);
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "RealTrack transfer failed.",
      );
    } finally {
      setTransferring(false);
    }
  };

  const selectedCount = selected.size;
  const skippedCount = items.filter((item) => item.skipReason).length;

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Cross-application workflow"
        title="RealTrack listing bridge"
        description="Choose active PartsBazar offers, review the calculated selling price, and transfer the selected records into RealTrack."
        actions={
          <Button variant="outline" onClick={load} loading={loading}>
            Refresh offers
          </Button>
        }
      />

      {error && (
        <p
          className="break-anywhere rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px_140px_auto] md:items-end">
          <Input
            label="Search offers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, MPN, SKU, or brand"
          />
          <Input
            label="Cost currency"
            value={sourceCurrency}
            maxLength={3}
            onChange={(event) =>
              setSourceCurrency(event.target.value.toUpperCase())
            }
          />
          <Input
            label="Target currency"
            value={targetCurrency}
            maxLength={3}
            onChange={(event) =>
              setTargetCurrency(event.target.value.toUpperCase())
            }
          />
          <Button variant="outline" onClick={load} disabled={loading}>
            Apply filters
          </Button>
        </div>
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-semibold">Pricing formula</p>
          <p className="mt-1">
            $5–$15 → $38.00 · $16–$21 → $45.99 · $22–$25 → $49.99 · above $25 →
            cost × 2 · below $5 → skip
          </p>
          <p className="mt-1 text-xs text-blue-800">
            The bridge uses seller base cost first, then falls back to the offer
            price. Currency must match the selected cost currency. The target
            currency is passed to RealTrack when optional eBay publishing is
            enabled.
          </p>
        </div>
      </section>

      <StatGrid className="lg:grid-cols-3">
        <StatCard
          label="Offers shown"
          value={String(items.length)}
          helper={`${total} matching active offers`}
        />
        <StatCard
          label="Eligible"
          value={String(eligibleItems.length)}
          helper="Ready for the selected formula"
        />
        <StatCard
          label="Selected"
          value={String(selectedCount)}
          helper={`${skippedCount} shown with a skip reason`}
        />
      </StatGrid>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              PartsBazar offers
            </h2>
            <p className="mt-1 text-xs text-graphite-600">
              Select individual offers; one canonical part can have several
              seller offers.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={selectEligible}
            disabled={!eligibleItems.length}
          >
            Select eligible
          </Button>
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-graphite-600">
            Loading offers…
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No matching offers"
              description="Try a different search or cost currency."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const checked = selected.has(item.offerId);
              return (
                <label
                  key={item.offerId}
                  className="flex cursor-pointer gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(item.offerId)}
                    className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <span className="min-w-0">
                        <span className="block break-anywhere text-sm font-semibold text-slate-900">
                          {item.title}
                        </span>
                        <span className="mt-1 block break-anywhere text-xs text-graphite-600">
                          {item.seller?.name || "Seller"} ·{" "}
                          {item.sellerSku || item.sku} ·{" "}
                          {item.sourceTag || "No source tag"} ·{" "}
                          {item.imageCount} image
                          {item.imageCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                        <span className="text-graphite-600">
                          Cost {item.cost.toFixed(2)} {item.currency}
                        </span>
                        {item.skipReason ? (
                          <Badge size="sm" tone="warning">
                            {skipLabels[item.skipReason] || item.skipReason}
                          </Badge>
                        ) : (
                          <Badge size="sm" tone="success">
                            Sell {item.sellingPrice?.toFixed(2)}{" "}
                            {item.targetCurrency}
                          </Badge>
                        )}
                      </span>
                    </span>
                    <span className="mt-2 block text-xs text-graphite-600">
                      Quantity {item.quantity}
                      {item.skipDetail ? ` · ${item.skipDetail}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-amber-950">
          Transfer options
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-start gap-3 text-sm text-amber-950">
            <input
              type="checkbox"
              checked={includeOutOfStock}
              onChange={(event) => setIncludeOutOfStock(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-700"
            />
            <span>
              <span className="block font-medium">
                Include zero-inventory offers
              </span>
              <span className="mt-1 block text-xs text-amber-800">
                Normally these are skipped because they cannot publish usefully.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-amber-950">
            <input
              type="checkbox"
              checked={publishToEbay}
              onChange={(event) => setPublishToEbay(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-700"
            />
            <span>
              <span className="block font-medium">
                Publish on eBay after transfer
              </span>
              <span className="mt-1 block text-xs text-amber-800">
                Uses RealTrack’s existing eBay publisher and requires a write
                account with ebay.publish.
              </span>
            </span>
          </label>
        </div>
        {publishToEbay && (
          <div className="mt-4 max-w-xl">
            <Input
              label="RealTrack store IDs"
              value={storeIds}
              onChange={(event) => setStoreIds(event.target.value)}
              placeholder="Comma-separated UUIDs"
              hint="The store IDs must belong to the RealTrack account used by the bridge."
            />
          </div>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-800">
            Transfer creates or updates RealTrack draft/ready records by
            deterministic SKU. It does not delete PartsBazar offers.
          </p>
          <Button
            onClick={transfer}
            loading={transferring}
            disabled={!selectedCount}
          >
            Transfer {selectedCount || ""} selected
          </Button>
        </div>
      </section>

      {result && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-emerald-950">
            Transfer result
          </h2>
          <p className="mt-1 text-sm text-emerald-900">
            {result.counts?.transferred || 0} transferred ·{" "}
            {result.counts?.skipped || 0} skipped ·{" "}
            {result.counts?.transferFailed || 0} failed
            {publishToEbay
              ? ` · ${result.counts?.published || 0} published`
              : ""}
          </p>
          {result.results?.some(
            (entry) => entry.error || entry.publishError,
          ) && (
            <ul className="mt-3 space-y-1 text-xs text-red-700">
              {result.results
                .filter((entry) => entry.error || entry.publishError)
                .map((entry) => (
                  <li key={entry.offerId}>
                    {entry.offerId}: {entry.error || entry.publishError}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </PageBody>
  );
}
