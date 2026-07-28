"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClasses } from "@repo/ui/button";
import { ArrowLeftIcon, CheckCircleIcon, MessageIcon, PackageIcon, RotateCcwIcon, TruckIcon } from "@repo/ui/icons";
import {
  getStoredOrders,
  orderMoneyBreakdown,
  type StoredOrder,
} from "@/lib/order-history";
import { formatPrice, humanize } from "@/lib/format";

export default function PurchaseDetailsPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<StoredOrder | null | undefined>(undefined);
  useEffect(() => setOrder(getStoredOrders().find((item) => item.id === decodeURIComponent(params.id)) || null), [params.id]);

  if (order === undefined) return <div className="h-80 animate-pulse bg-white" aria-label="Loading order" />;
  if (!order) return <div className="border-2 border-slate-950 bg-white p-8"><h2 className="font-display text-2xl font-black uppercase text-slate-950">Order not found on this device</h2><p className="mt-2 text-sm text-slate-600">Open purchase history from the same browser used at checkout, or contact support with your confirmation email.</p><Link href="/account/purchases" className={`${buttonClasses({ variant: "outline" })} mt-5`}><ArrowLeftIcon className="h-4 w-4" />Purchase history</Link></div>;

  const breakdown = orderMoneyBreakdown(order);

  return (
    <section>
      <Link href="/account/purchases" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeftIcon className="h-4 w-4" />All purchases</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-graphite-950 pb-4"><div className="min-w-0"><p className="eyebrow">Order detail</p><h2 className="part-number mt-1 break-anywhere text-base font-bold text-graphite-950 sm:text-xl">{order.id}</h2><p className="mt-1 text-sm text-graphite-600">Placed {new Date(order.createdAt).toLocaleString()}</p></div><p className="price text-2xl">{formatPrice(order.totalAmount, order.currency)}</p></div>

      <ol className="mt-5 grid border-l border-t border-stone-300 sm:grid-cols-3" aria-label="Order status">
        {[
          [CheckCircleIcon, "Order placed", "Checkout received"],
          [PackageIcon, "Payment", humanize(order.paymentStatus)],
          [TruckIcon, "Tracking", "Added by each seller after dispatch"],
        ].map(([Icon, title, detail]) => { const StatusIcon = Icon as typeof CheckCircleIcon; return <li key={title as string} className="border-b border-r border-stone-300 bg-white p-4"><StatusIcon className="h-5 w-5 text-brand-700" /><p className="mt-3 text-sm font-black uppercase text-slate-950">{title as string}</p><p className="mt-1 text-xs text-graphite-600">{detail as string}</p></li>; })}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {order.items.map((item) => (
            <article key={item.id} className="flex gap-4 border border-stone-300 bg-white p-4"><div className="h-20 w-20 shrink-0 bg-stone-100" /> <div className="min-w-0 flex-1"><Link href={item.sellerOffer.canonicalPart?.id ? `/part/${item.sellerOffer.canonicalPart.id}` : "/search"} className="line-clamp-2 text-sm font-bold text-slate-950 hover:text-brand-700">{item.sellerOffer.canonicalPart?.title || "Marketplace part"}</Link><p className="mt-1 text-xs text-graphite-600">{humanize(item.sellerOffer.condition || "USED")} · Quantity {item.quantity}</p><p className="mt-2 text-sm font-semibold text-slate-700">Seller: {item.sellerOffer.seller?.name || "Marketplace seller"}</p></div><p className="price text-sm">{formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}</p></article>
          ))}
        </div>
        <aside className="space-y-4">
          <div className="border-2 border-slate-950 bg-white p-4">
            <p className="eyebrow">Order totals</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-graphite-600">Items</dt>
                <dd className="price text-sm">{formatPrice(breakdown.itemsSubtotal, order.currency)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-graphite-600">Shipping</dt>
                <dd className="price text-sm">{formatPrice(breakdown.shippingTotal, order.currency)}</dd>
              </div>
              {order.sellerOrders.length > 1 && (
                <ul className="space-y-1 border-t border-stone-200 pt-2 text-xs text-graphite-600">
                  {order.sellerOrders.map((so, index) => (
                    <li key={so.id || index} className="flex justify-between gap-2">
                      <span>Shipment {index + 1}</span>
                      <span>{formatPrice(so.shippingTotal || 0, order.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-between gap-3 border-t border-stone-200 pt-2 text-base">
                <dt className="font-semibold text-slate-950">Total</dt>
                <dd className="price">{formatPrice(breakdown.totalAmount, order.currency)}</dd>
              </div>
            </dl>
          </div>
          <div className="border-2 border-slate-950 bg-white p-4"><p className="eyebrow">Delivery address</p><p className="mt-3 text-sm leading-relaxed text-slate-700">{order.shippingAddress.name}<br />{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}<br />{order.shippingAddress.city} {order.shippingAddress.postalCode}<br />{order.shippingAddress.country}</p></div>
          <Link href={`/support?orderId=${encodeURIComponent(order.id)}&category=ORDER_ISSUE&subject=${encodeURIComponent(`Question about order ${order.id}`)}`} className={`${buttonClasses()} w-full`}><MessageIcon className="h-4 w-4" />Contact seller / support</Link>
          <Link href={`/support?orderId=${encodeURIComponent(order.id)}&category=RETURNS&subject=${encodeURIComponent(`Return request for order ${order.id}`)}`} className={`${buttonClasses({ variant: "outline" })} w-full`}><RotateCcwIcon className="h-4 w-4" />Start a return</Link>
        </aside>
      </div>
    </section>
  );
}
