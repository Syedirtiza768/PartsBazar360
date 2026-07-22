"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { buttonClasses } from "@repo/ui/button";

function CancelContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Payment cancelled</h1>
      <p className="mt-2 text-sm text-graphite-600">
        You left Stripe Checkout before paying. Your cart may already be checked out for this attempt
        {orderId ? (
          <>
            {" "}
            (order <span className="part-number text-slate-800">{orderId}</span>)
          </>
        ) : null}
        . Add items again if you still want to buy.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/cart" className={buttonClasses()}>
          Back to cart
        </Link>
        <Link href="/search" className={buttonClasses({ variant: "outline" })}>
          Browse parts
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutCancelPage() {
  return (
    <Suspense fallback={<div className="px-4 py-16 text-center text-sm text-graphite-600">Loading…</div>}>
      <CancelContent />
    </Suspense>
  );
}
