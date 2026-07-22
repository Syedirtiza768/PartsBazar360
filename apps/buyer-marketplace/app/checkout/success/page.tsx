"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { buttonClasses } from "@repo/ui/button";
import { CheckCircleIcon, ReceiptIcon } from "@repo/ui/icons";

function SuccessContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <div className="text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircleIcon className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Payment submitted
        </h1>
        <p className="mt-2 text-graphite-600">
          Stripe handled your payment securely. Card details never reached PartsBazar360. Sellers are
          notified once payment is confirmed.
        </p>
      </div>

      {orderId && (
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ReceiptIcon className="h-4 w-4 text-slate-400" />
              Order reference
            </p>
          </div>
          <p className="part-number px-5 py-4 text-sm text-slate-900">{orderId}</p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/search" className={buttonClasses()}>
          Continue shopping
        </Link>
        {orderId && (
          <Link
            href={`/account/purchases/${encodeURIComponent(orderId)}`}
            className={buttonClasses({ variant: "outline" })}
          >
            View purchase
          </Link>
        )}
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="px-4 py-16 text-center text-sm text-graphite-600">Loading…</div>}>
      <SuccessContent />
    </Suspense>
  );
}
