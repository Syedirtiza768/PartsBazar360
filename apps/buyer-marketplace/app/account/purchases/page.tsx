"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { ArrowRightIcon, PackageIcon, ReceiptIcon, StoreIcon } from "@repo/ui/icons";
import { getStoredOrders, type StoredOrder } from "@/lib/order-history";
import { formatPrice } from "@/lib/format";

export default function PurchasesPage() {
  const [orders, setOrders] = useState<StoredOrder[] | null>(null);
  useEffect(() => {
    const load = () => setOrders(getStoredOrders());
    load();
    window.addEventListener("pb360:orders-changed", load);
    return () => window.removeEventListener("pb360:orders-changed", load);
  }, []);

  return (
    <section>
      <div className="flex items-end justify-between border-b-2 border-slate-950 pb-3"><div><p className="eyebrow">Purchase history</p><h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950 sm:text-3xl">Orders & tracking</h2></div>{orders && <span className="font-mono text-xs font-bold text-graphite-600">{orders.length} orders</span>}</div>
      {orders?.length === 0 ? (
        <div className="mt-6 border-2 border-slate-950 bg-white"><EmptyState variant="page" icon={<ReceiptIcon />} title="No purchases on this device" description="Completed checkouts will appear here with seller shipment and support actions."><Link href="/search" className={buttonClasses()}>Shop parts</Link></EmptyState></div>
      ) : (
        <div className="mt-5 space-y-4">
          {(orders || []).map((order) => (
            <article key={order.id} className="border border-stone-300 bg-white">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-300 bg-[#ebe8e1] px-4 py-3 sm:px-5"><div><p className="part-number font-bold text-slate-950">Order {order.id}</p><p className="mt-0.5 text-xs text-graphite-600">Placed {new Date(order.createdAt).toLocaleDateString()}</p></div><span className="border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-brand-800">{order.paymentStatus.replace(/_/g, " ")}</span></header>
              <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_auto]">
                <div><p className="flex items-center gap-2 text-sm font-bold text-slate-950"><PackageIcon className="h-4 w-4 text-brand-700" />{order.items.reduce((sum, item) => sum + item.quantity, 0)} item{order.items.length === 1 ? "" : "s"} across {order.sellerOrders.length} seller shipment{order.sellerOrders.length === 1 ? "" : "s"}</p><ul className="mt-3 space-y-2">{order.items.slice(0, 3).map((item) => <li key={item.id} className="flex items-center gap-2 text-sm text-slate-600"><StoreIcon className="h-4 w-4 text-slate-400" /><span className="line-clamp-1">{item.quantity} × {item.sellerOffer.canonicalPart?.title || "Marketplace part"}</span></li>)}</ul></div>
                <div className="flex items-end justify-between gap-6 border-t border-stone-200 pt-4 lg:block lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><p className="price text-xl">{formatPrice(order.totalAmount, order.currency)}</p><Link href={`/account/purchases/${encodeURIComponent(order.id)}`} className="mt-3 inline-flex items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-700">Order details <ArrowRightIcon className="h-4 w-4" /></Link></div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
