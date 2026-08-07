"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { ArrowLeftIcon } from "@repo/ui/icons";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { orderStatusTone } from "@/lib/order-status";

interface OrderDetail {
  id: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  shippingAddress?: Record<string, unknown> | null;
  buyer?: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  paymentIntent?: {
    id: string;
    provider: string;
    status: string;
    amount: number;
    currency: string;
    externalId?: string | null;
  } | null;
  sellerOrders: Array<{
    id: string;
    status: string;
    subTotal: number;
    shippingTotal: number;
    trackingNumber?: string | null;
    carrier?: string | null;
    seller?: { name?: string };
    items: Array<{
      id: string;
      quantity: number;
      unitPrice: number;
      sellerOffer: { canonicalPart?: { title?: string } | null; sellerTitle?: string | null };
    }>;
  }>;
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { token } = useAdminAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [acting, setActing] = useState<"cancel" | "refund" | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/operations/orders/${params.orderId}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Order not found." : "Could not load order.");
      setOrder(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load order.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, params.orderId]);

  const canCancel =
    order && !["CANCELLED", "REFUNDED"].includes(order.status) &&
    !order.sellerOrders.some((so) => ["SHIPPED", "DELIVERED"].includes(so.status));
  const canRefund = order?.paymentIntent?.status === "SUCCEEDED";

  const cancelOrder = async () => {
    if (!order || !confirm(`Cancel order ${order.id}? This can't be undone.`)) return;
    setActing("cancel");
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/operations/orders/${order.id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not cancel order.");
      setMessage(data.refunded ? "Order cancelled and payment refunded." : "Order cancelled.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not cancel order.");
    } finally {
      setActing(null);
    }
  };

  const refundOrder = async () => {
    if (!order) return;
    const reason = prompt("Reason for refund (optional):") ?? undefined;
    if (!confirm(`Refund order ${order.id}? This charges the refund back to the buyer.`)) return;
    setActing("refund");
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/operations/orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not refund order.");
      setMessage("Payment refunded.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not refund order.");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <PageBody className="space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageBody>
    );
  }

  if (!order) {
    return (
      <PageBody className="space-y-4">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Order not found."}
        </p>
        <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700">
          <ArrowLeftIcon className="h-4 w-4" /> Back to orders
        </Link>
      </PageBody>
    );
  }

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <div>
        <button
          type="button"
          onClick={() => router.push("/orders")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to orders
        </button>
      </div>

      <PageHeader
        eyebrow="Order detail"
        title={order.id}
        description={`Placed ${new Date(order.createdAt).toLocaleString()}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={orderStatusTone(order.status)}>{order.status.replace(/_/g, " ")}</Badge>
            {canCancel && (
              <Button variant="outline" size="sm" loading={acting === "cancel"} onClick={cancelOrder}>
                Cancel order
              </Button>
            )}
            {canRefund && (
              <Button variant="dark" size="sm" loading={acting === "refund"} onClick={refundOrder}>
                Refund payment
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5" aria-label="Buyer">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Buyer</h2>
          <p className="mt-2 font-semibold text-slate-900">{order.buyer?.name || "Guest"}</p>
          {order.buyer?.email && (
            <p className="mt-1 text-sm text-graphite-600">
              <a href={`mailto:${order.buyer.email}`} className="text-blue-700 hover:underline">
                {order.buyer.email}
              </a>
            </p>
          )}
          {order.buyer?.phone && <p className="mt-1 text-sm text-graphite-600">{order.buyer.phone}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5" aria-label="Payment">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Payment</h2>
          {order.paymentIntent ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={orderStatusTone(order.paymentIntent.status)} size="sm">
                  {order.paymentIntent.status}
                </Badge>
                <span className="text-sm text-graphite-600 capitalize">{order.paymentIntent.provider}</span>
              </div>
              <p className="mt-2 price text-lg text-slate-900">
                {order.paymentIntent.currency} {order.paymentIntent.amount.toFixed(2)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-graphite-600">No payment record.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5" aria-label="Order total">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Order total</h2>
          <p className="mt-2 price text-2xl font-bold text-slate-900">
            {order.currency} {order.totalAmount.toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-graphite-600">
            {order.sellerOrders.length} seller{order.sellerOrders.length === 1 ? "" : "s"}
          </p>
        </section>
      </div>

      <section aria-label="Seller orders" className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Seller orders</h2>
        {order.sellerOrders.map((so) => (
          <div key={so.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
              <div>
                <p className="font-semibold text-slate-900">{so.seller?.name || "Seller"}</p>
                <p className="part-number text-xs text-graphite-600">{so.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={orderStatusTone(so.status)} size="sm">
                  {so.status.replace(/_/g, " ")}
                </Badge>
                {so.trackingNumber && (
                  <span className="text-xs text-graphite-600">
                    {so.carrier} {so.trackingNumber}
                  </span>
                )}
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {so.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 text-sm text-slate-700">
                    <span className="font-semibold">{item.quantity}×</span>{" "}
                    {item.sellerOffer.canonicalPart?.title || item.sellerOffer.sellerTitle || "Part"}
                  </span>
                  <span className="shrink-0 price text-sm">
                    {order.currency} {(item.unitPrice * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </PageBody>
  );
}
