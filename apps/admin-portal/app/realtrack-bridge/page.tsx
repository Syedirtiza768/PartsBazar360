"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { EmptyState } from "@repo/ui/empty-state";
import { Input, Select } from "@repo/ui/field";
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
  convertedCostUsd?: number | null;
  conversionRateToUsd?: number | null;
  targetCurrency: string;
  sellingPrice: number | null;
  quantity: number;
  imageCount: number;
  fitmentCount: number;
  skipReason: string | null;
  skipDetail: string | null;
}

interface BridgeListResponse {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  sourceCurrency: string;
  targetCurrency: string;
  items: BridgeItem[];
}

interface TransferResponse {
  dryRun: boolean;
  status?: string;
  jobId?: string;
  message?: string;
  error?: string;
  progress?: {
    phase?: string;
    total?: number;
    eligible?: number;
    processed?: number;
    transferred?: number;
    failed?: number;
    skipped?: number;
  };
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
  currency_conversion_unavailable: "FX unavailable",
  no_inventory: "No inventory",
  inactive_offer: "Inactive",
  invalid_cost: "Invalid cost",
};

const SOURCE_TAGS = ["AAP", "BLK", "BST", "GEN", "PSRC", "SAL", "TNRU", "YNTD"];

type SellerOption = {
  id: string;
  name: string;
};

export default function RealtrackBridgePage() {
  const { token } = useAdminAuth();
  const [sourceCurrency, setSourceCurrency] = useState("");
  const targetCurrency = "USD";
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [sourceTag, setSourceTag] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [items, setItems] = useState<BridgeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [publishToEbay, setPublishToEbay] = useState(false);
  const [storeIds, setStoreIds] = useState("");
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResponse | null>(null);
  const [transferProgress, setTransferProgress] = useState<
    TransferResponse["progress"] | null
  >(null);

  const load = async (pageToLoad = page, resetSelection = false) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "100",
        page: String(pageToLoad),
        targetCurrency,
      });
      if (sourceCurrency.trim()) {
        params.set("sourceCurrency", sourceCurrency.trim().toUpperCase());
      }
      if (search.trim()) params.set("search", search.trim());
      if (brand.trim()) params.set("brand", brand.trim());
      if (sourceTag) params.set("sourceTag", sourceTag);
      if (sellerId) params.set("sellerId", sellerId);
      if (status) params.set("status", status);
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
      setPage(data.page || pageToLoad);
      setHasMore(Boolean(data.hasMore));
      if (resetSelection) {
        setSelected(new Set());
        setSelectAllMatching(false);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not load bridge offers.",
      );
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    void load(1, true);
  };

  const loadSellers = async () => {
    if (!token) return;
    try {
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/operations/sellers/onboarding`,
      );
      if (!response.ok) return;
      const body = await response.json().catch(() => []);
      setSellers(
        Array.isArray(body)
          ? body
              .filter(
                (seller): seller is { id: string; name?: string | null } =>
                  Boolean(seller && typeof seller.id === "string"),
              )
              .map((seller) => ({
                id: seller.id,
                name: seller.name?.trim() || seller.id,
              }))
          : [],
      );
    } catch {
      // Seller filtering remains available as a blank state if the optional
      // seller directory request is unavailable.
    }
  };

  useEffect(() => {
    load();
    loadSellers();
    // Loading on first authenticated render is intentional; the controls use Refresh for subsequent changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const eligibleItems = useMemo(
    () => items.filter((item) => !item.skipReason),
    [items],
  );

  const toggleSelected = (offerId: string) => {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelected(new Set([offerId]));
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(offerId)) {
        next.delete(offerId);
      } else if (next.size < 5000) {
        next.add(offerId);
      } else {
        setError("A transfer can contain at most 5,000 offers.");
      }
      return next;
    });
  };

  const selectEligible = () => {
    setSelected(
      (current) =>
        new Set(
          [...current, ...eligibleItems.map((item) => item.offerId)].slice(
            0,
            5000,
          ),
        ),
    );
    setSelectAllMatching(false);
  };

  const selectAllFiltered = () => {
    setSelected(new Set());
    setSelectAllMatching(true);
  };

  const filterPayload = () => ({
    ...(sourceCurrency.trim()
      ? { sourceCurrency: sourceCurrency.trim().toUpperCase() }
      : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(brand.trim() ? { brand: brand.trim() } : {}),
    ...(sourceTag ? { sourceTag } : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(status ? { status } : {}),
  });

  const waitForTransfer = async (jobId: string) => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const response = await apiFetch(
        token!,
        `${API_BASE_URL}/admin/realtrack-bridge/transfer/${encodeURIComponent(jobId)}`,
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as TransferResponse;
      if (!response.ok)
        throw new Error(body.message || "Could not read transfer progress.");
      if (body.progress) setTransferProgress(body.progress);
      if (body.status === "completed") return body;
      if (body.status === "failed") {
        throw new Error(
          body.error || "RealTrack transfer failed in the background.",
        );
      }
    }
  };

  const transfer = async () => {
    if (!token || (!selectAllMatching && selected.size === 0)) {
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
    setTransferProgress(null);
    try {
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/admin/realtrack-bridge/transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(selectAllMatching
              ? { selectAll: true, maxItems: 5000 }
              : { offerIds: Array.from(selected) }),
            ...filterPayload(),
            targetCurrency,
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
      const queued = body as TransferResponse;
      const completed = queued.jobId
        ? await waitForTransfer(queued.jobId)
        : queued;
      setResult(completed);
      setSelected(new Set());
      setSelectAllMatching(false);
      await load(page);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "RealTrack transfer failed.",
      );
    } finally {
      setTransferring(false);
    }
  };

  const selectedCount = selectAllMatching
    ? Math.min(total, 5000)
    : selected.size;
  const skippedCount = items.filter((item) => item.skipReason).length;

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Cross-application workflow"
        title="RealTrack listing bridge"
        description="Choose active PartsBazar offers, review the calculated selling price, and transfer the selected records into RealTrack."
        actions={
          <Button
            variant="outline"
            onClick={() => void load()}
            loading={loading}
          >
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)_140px_140px_auto] xl:items-end">
          <Input
            label="Search offers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, MPN, SKU, or brand"
          />
          <Input
            label="Brand filter"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            placeholder="e.g. FEBI"
          />
          <Select
            label="Source"
            value={sourceTag}
            onChange={(event) => setSourceTag(event.target.value)}
          >
            <option value="">All sources</option>
            {SOURCE_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
          <Select
            label="Seller"
            value={sellerId}
            onChange={(event) => setSellerId(event.target.value)}
          >
            <option value="">All sellers</option>
            {sellers.map((seller) => (
              <option key={seller.id} value={seller.id}>
                {seller.name}
              </option>
            ))}
          </Select>
          <Select
            label="Offer status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ACTIVE">Active</option>
            <option value="">All statuses</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Input
            label="Source currency filter"
            value={sourceCurrency}
            maxLength={3}
            placeholder="ALL"
            hint="Leave blank to convert every source currency to USD."
            onChange={(event) =>
              setSourceCurrency(event.target.value.toUpperCase())
            }
          />
          <Input
            label="Target currency"
            value={targetCurrency}
            readOnly
            hint="The bridge always sends USD to RealTrack."
          />
          <Button variant="outline" onClick={applyFilters} disabled={loading}>
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
            price. Every source currency is converted to USD before the pricing
            bands are applied. The complete image gallery and available fitment
            rows are sent with the listing.
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
              Page {page} · {total.toLocaleString()} matching offers. Selection
              can be applied to the complete filtered result, not just this
              page.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={selectEligible}
              disabled={!eligibleItems.length || selectAllMatching}
            >
              Select page
            </Button>
            {total > items.length && (
              <Button
                size="sm"
                onClick={selectAllFiltered}
                disabled={selectAllMatching || !total}
              >
                {selectAllMatching
                  ? `All ${selectedCount.toLocaleString()} selected`
                  : `Select all ${Math.min(total, 5000).toLocaleString()}`}
              </Button>
            )}
          </div>
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
              const checked = selectAllMatching || selected.has(item.offerId);
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
                          {" · "}
                          {item.fitmentCount} fitment
                          {item.fitmentCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                        <span className="text-graphite-600">
                          Cost {item.cost.toFixed(2)} {item.currency}
                          {item.convertedCostUsd != null &&
                          item.currency.toUpperCase() !== "USD"
                            ? ` → ${item.convertedCostUsd.toFixed(2)} USD`
                            : ""}
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

      <div className="flex flex-col gap-3 text-sm text-graphite-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {items.length ? (page - 1) * 100 + 1 : 0}–
          {(page - 1) * 100 + items.length} of {total.toLocaleString()}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(page - 1)}
            disabled={loading || page <= 1}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(page + 1)}
            disabled={loading || !hasMore}
          >
            Next
          </Button>
        </div>
      </div>

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
            deterministic SKU. It does not delete PartsBazar offers. Large
            transfers run in the background and are paced with automatic 429
            retries.
          </p>
          {transferring && transferProgress && (
            <p className="text-xs font-medium text-amber-900">
              {transferProgress.phase === "publishing"
                ? "Publishing transferred listings…"
                : `Transferred ${transferProgress.transferred || 0} of ${transferProgress.eligible || transferProgress.total || selectedCount}; ${transferProgress.failed || 0} failed`}
            </p>
          )}
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
