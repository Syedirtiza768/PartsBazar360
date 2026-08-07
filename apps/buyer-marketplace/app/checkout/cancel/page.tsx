"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { buttonClasses } from "@repo/ui/button";

function CancelContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const provider = params.get("provider") === "tamara" ? "Tamara" : "Stripe";
  const failed = params.get("reason") === "failed";

  return (
    <div className="mx-auto max-w-lg gutter py-12 text-center sm:py-16">
      <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Payment {failed ? "couldn’t be completed" : "cancelled"}
      </h1>
      <p className="mt-2 text-sm text-graphite-600">
        {failed
          ? `${provider} could not complete this payment.`
          : `You left ${provider} before paying.`}{" "}
        Your cart, verified phone, and delivery details are still saved
        {orderId ? (
          <>
            {" "}
            (order <span className="part-number text-slate-800">{orderId}</span>
            )
          </>
        ) : null}
        . You can retry payment without entering them again.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/checkout" className={buttonClasses()}>
          Try payment again
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
    <Suspense
      fallback={
        <div className="gutter py-16 text-center text-sm text-graphite-600">
          Loading…
        </div>
      }
    >
      <CancelContent />
    </Suspense>
  );
}
