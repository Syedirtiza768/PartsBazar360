"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@repo/ui/button";
import { ArrowRightIcon, CheckCircleIcon, MessageIcon, RotateCcwIcon, ShieldCheckIcon } from "@repo/ui/icons";
import { getStoredOrders, type StoredOrder } from "@/lib/order-history";

export default function ReturnsPage() {
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  useEffect(() => setOrders(getStoredOrders()), []);

  return (
    <section>
      <div className="border-b-2 border-slate-950 pb-3"><p className="eyebrow">Resolution centre</p><h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950 sm:text-3xl">Returns, refunds & issues</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Start with the seller and the exact order. If the issue cannot be resolved, the same case can be reviewed by marketplace support.</p></div>
      <ol className="mt-5 grid border-l border-t border-stone-300 md:grid-cols-3">
        {[
          [MessageIcon, "1. Open a request", "Choose the purchase and explain whether the issue is fitment, condition, damage, delivery, or another problem."],
          [RotateCcwIcon, "2. Work with the seller", "Keep replies, requested evidence, return instructions, and refund status in the same case."],
          [ShieldCheckIcon, "3. Ask support to review", "If the seller cannot resolve it, marketplace support has the listing and order context needed to investigate."],
        ].map(([Icon, title, description]) => { const StepIcon = Icon as typeof MessageIcon; return <li key={title as string} className="border-b border-r border-stone-300 bg-white p-5"><StepIcon className="h-6 w-6 text-brand-700" /><h3 className="mt-5 font-display text-lg font-black uppercase text-slate-950">{title as string}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{description as string}</p></li>; })}
      </ol>

      <div className="mt-8">
        <p className="eyebrow">Choose a purchase</p>
        {orders.length ? <div className="mt-3 space-y-3">{orders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 border border-stone-300 bg-white p-4"><div><p className="part-number font-bold text-slate-950">{order.id}</p><p className="mt-1 text-xs text-graphite-600">{order.items.length} line item{order.items.length === 1 ? "" : "s"} · {new Date(order.createdAt).toLocaleDateString()}</p></div><Link href={`/support?orderId=${encodeURIComponent(order.id)}&category=RETURNS&subject=${encodeURIComponent(`Return or issue for order ${order.id}`)}`} className={buttonClasses({ variant: "outline" })}>Open request <ArrowRightIcon className="h-4 w-4" /></Link></div>)}</div> : <div className="mt-3 border border-stone-300 bg-white p-5"><p className="flex items-center gap-2 text-sm font-bold text-slate-950"><CheckCircleIcon className="h-4 w-4 text-brand-700" />No purchases available on this device</p><p className="mt-1 text-sm text-slate-600">If you checked out elsewhere, open a general support request and include the order number from your confirmation.</p><Link href="/support?category=RETURNS" className={`${buttonClasses({ variant: "outline" })} mt-4`}>Contact support</Link></div>}
      </div>
    </section>
  );
}
