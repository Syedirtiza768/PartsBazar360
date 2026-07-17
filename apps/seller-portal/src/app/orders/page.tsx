"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { Input, Select } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { TruckIcon, XIcon, RefreshIcon, CheckCircleIcon, ClockIcon } from "@repo/ui/icons";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
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

/** Modal replacing the old window.prompt() tracking flow. */
function ShipDialog({
  order,
  onClose,
  onShipped,
}: {
  order: SellerOrder;
  onClose: () => void;
  onShipped: () => void;
}) {
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("DHL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) {
      setError("Enter the tracking number from your shipping label.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/merchant/orders/${order.id}/fulfill?sellerId=${DEMO_SELLER_ID}`,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Mark order as shipped">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-graphite-950/50 backdrop-blur-[2px] animate-fade-in" />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-6 shadow-overlay animate-slide-up sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Mark as shipped</h2>
            <p className="mt-1 text-sm text-slate-500">
              Order <span className="part-number">#{order.id.split("-")[0]}</span> · {order.items.length} item
              {order.items.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
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
            error={error ?? undefined}
            hint="The buyer receives this immediately — double-check it matches the label."
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              <TruckIcon className="h-4 w-4" />
              Confirm shipment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [error, setError] = useState(false);
  const [shipping, setShipping] = useState<SellerOrder | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loading = orders === null && !error;

  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/orders?sellerId=${DEMO_SELLER_ID}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
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
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
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
            <section key={order.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-label={`Order ${order.id.split("-")[0]}`}>
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="part-number text-slate-500">#{order.id.split("-")[0]}</span>
                    <StatusBadge status={order.status} size="sm" />
                  </div>
                  <p className="text-lg font-semibold text-slate-900">
                    {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                    <span className="price">AED {(order.subTotal + order.shippingTotal).toLocaleString()}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-slate-500">
                    <ClockIcon className="h-4 w-4" />
                    Placed {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-4 xl:w-auto xl:min-w-[360px]">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{item.quantity}×</span>{" "}
                          {item.sellerOffer.canonicalPart?.title || "Part"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex shrink-0 items-start justify-between gap-2 xl:flex-col xl:items-end">
                  {order.status === "PROCESSING" ? (
                    <Button onClick={() => setShipping(order)}>
                      <TruckIcon className="h-4 w-4" />
                      Mark as shipped
                    </Button>
                  ) : order.status === "SHIPPED" ? (
                    <div className="xl:text-right">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 xl:justify-end">
                        <CheckCircleIcon className="h-4 w-4" />
                        Shipped
                      </p>
                      {order.trackingNumber && (
                        <p className="part-number mt-1 text-slate-500">
                          {order.carrier} {order.trackingNumber}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="xl:text-right">
                      <p className="text-sm font-semibold text-amber-700">Awaiting payment</p>
                      <p className="mt-1 max-w-[220px] text-xs text-slate-500">
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
    </div>
  );
}
