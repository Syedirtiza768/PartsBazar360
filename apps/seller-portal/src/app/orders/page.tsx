"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Input, Select } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import { Sheet } from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { TruckIcon, RefreshIcon, CheckCircleIcon, ClockIcon } from "@repo/ui/icons";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { useSellerAuth } from "@/lib/auth-context";
import { PartThumbnail } from "@/components/PartThumbnail";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

interface SellerOrderItem {
  id: string;
  quantity: number;
  sellerOffer: { canonicalPart?: { title?: string; imageUrls?: string[] } };
}

interface SellerOrder {
  id: string;
  status: string;
  subTotal: number;
  shippingTotal: number;
  trackingNumber?: string | null;
  carrier?: string | null;
  createdAt: string;
  items: SellerOrderItem[];
}

const CARRIERS = ["DHL", "FedEx", "UPS", "Aramex", "DPD", "Royal Mail", "Other"];

/**
 * Shipment confirmation. Built on the shared Sheet, so it is a bottom sheet on
 * phones and a centred dialog from `sm` up, and it inherits the focus trap,
 * iOS-safe scroll lock, dynamic-viewport height cap and safe-area footer that
 * the hand-rolled version lacked — the old one could put "Confirm shipment"
 * under the home indicator on a landscape phone with no way to scroll to it.
 */
function ShipDialog({
  order,
  onClose,
  onShipped,
}: {
  order: SellerOrder;
  onClose: () => void;
  onShipped: () => void;
}) {
  const { token, sellerId } = useSellerAuth();
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("DHL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) {
      setError("Enter the tracking number from your shipping label.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(
        token,
        `${API_BASE_URL}/merchant/orders/${order.id}/fulfill?sellerId=${sellerId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackingNumber: tracking.trim(), carrier }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not mark as shipped.");
      }
      onShipped();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not mark as shipped.");
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Mark as shipped"
      description={`Order #${order.id.split("-")[0]} · ${order.items.length} item${
        order.items.length === 1 ? "" : "s"
      }`}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} fullWidth className="sm:w-auto">
            Cancel
          </Button>
          <Button form="ship-form" type="submit" loading={submitting} fullWidth className="sm:w-auto">
            <TruckIcon className="h-4 w-4" />
            Confirm shipment
          </Button>
        </div>
      }
    >
      <form id="ship-form" onSubmit={submit} className="space-y-4">
        <Select label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          label="Tracking number"
          required
          value={tracking}
          onChange={(e) => {
            setTracking(e.target.value);
            setError(null);
          }}
          placeholder="e.g. JD014600003GB"
          // Tracking numbers are case-insensitive but always shown uppercase;
          // autocorrect would otherwise "fix" them into words on iOS.
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          error={error ?? undefined}
          hint="The buyer receives this immediately — double-check it matches the label."
        />
      </form>
    </Sheet>
  );
}

export default function OrdersPage() {
  const { token, sellerId } = useSellerAuth();
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [error, setError] = useState(false);
  const [shipping, setShipping] = useState<SellerOrder | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loading = orders === null && !error;

  const fetchOrders = async () => {
    if (!sellerId) return;
    setRefreshing(true);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/merchant/orders?sellerId=${sellerId}&page=1&limit=50`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (Array.isArray(data)) setOrders(data);
      else if (Array.isArray(data?.items)) setOrders(data.items);
      else setOrders([]);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sellerId]);

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Fulfillment"
        title="Order queue"
        description="Review pending orders, pack items, and add tracking numbers. Buyers are notified the moment a shipment is confirmed."
        actions={
          <Button variant="outline" onClick={fetchOrders} loading={refreshing}>
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          Couldn&apos;t load orders. Refresh to try again.
        </div>
      ) : loading ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl sm:h-44" />
          ))}
        </div>
      ) : orders!.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<TruckIcon />}
          title="No orders yet"
          description="Orders appear here the moment buyers check out with your offers. Keep listings priced and stocked to convert."
        />
      ) : (
        <div className="space-y-4">
          {orders!.map((order) => (
            <section
              key={order.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6"
              aria-label={`Order ${order.id.split("-")[0]}`}
            >
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="part-number text-graphite-600">#{order.id.split("-")[0]}</span>
                    <StatusBadge status={order.status} size="sm" />
                  </div>
                  <p className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                    {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                    <span className="price">AED {(order.subTotal + order.shippingTotal).toLocaleString()}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-graphite-600">
                    <ClockIcon className="h-4 w-4 shrink-0" />
                    Placed {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 xl:w-auto xl:min-w-[340px] xl:max-w-[420px]">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-graphite-600">
                    Items to ship
                  </h3>
                  <ul className="mt-3 space-y-2.5">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 text-sm text-slate-700">
                        <PartThumbnail
                          src={item.sellerOffer.canonicalPart?.imageUrls?.[0]}
                          alt=""
                          size={36}
                        />
                        {/* line-clamp, not truncate: a picker needs enough of
                            the part name to find it on the shelf. */}
                        <span className="line-clamp-2 min-w-0">
                          <span className="font-semibold">{item.quantity}×</span>{" "}
                          {item.sellerOffer.canonicalPart?.title || "Part"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex shrink-0 flex-col gap-2 xl:items-end">
                  {order.status === "PROCESSING" ? (
                    <Button onClick={() => setShipping(order)} fullWidth className="sm:w-auto">
                      <TruckIcon className="h-4 w-4" />
                      Mark as shipped
                    </Button>
                  ) : order.status === "SHIPPED" ? (
                    <div className="xl:text-right">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 xl:justify-end">
                        <CheckCircleIcon className="h-4 w-4 shrink-0" />
                        Shipped
                      </p>
                      {order.trackingNumber && (
                        <p className="part-number mt-1 break-anywhere text-graphite-600">
                          {order.carrier} {order.trackingNumber}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="xl:text-right">
                      <p className="text-sm font-semibold text-amber-700">Awaiting payment</p>
                      <p className="mt-1 text-xs text-graphite-600 xl:max-w-[220px]">
                        Fulfilment unlocks after payment confirmation.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {shipping && (
        <ShipDialog
          order={shipping}
          onClose={() => setShipping(null)}
          onShipped={() => {
            setShipping(null);
            fetchOrders();
          }}
        />
      )}
    </PageBody>
  );
}
