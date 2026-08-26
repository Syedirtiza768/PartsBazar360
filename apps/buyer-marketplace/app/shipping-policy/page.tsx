import type { Metadata } from "next";
import Link from "next/link";
import { getShippingPolicy } from "@/lib/content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shipping Policy | PartsBazar360",
  description:
    "Shipping policy with the 2:00 PM GST cutoff, database-backed handling time, carriers, and international delivery terms.",
};

export default async function ShippingPolicyPage() {
  const policy = await getShippingPolicy();
  return (
    <div className="mx-auto max-w-3xl gutter py-8 sm:py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">
          Buyer policies
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Shipping Policy
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Shipping information for PartsBazar360 marketplace orders.
        </p>
      </header>
      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-slate-950 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-graphite-500">
            Order cutoff
          </p>
          <p className="mt-2 text-xl font-black text-slate-950">
            {policy.cutoffTime}
          </p>
          <p className="mt-1 text-xs text-graphite-600">{policy.timezone}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-graphite-500">
            Handling time
          </p>
          <p className="mt-2 text-xl font-black text-slate-950">
            {policy.handling.label}
          </p>
          <p className="mt-1 text-xs text-graphite-600">
            From {policy.handling.source}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          <p className="text-xs font-bold uppercase tracking-wider text-graphite-500">
            Fulfillment days
          </p>
          <p className="mt-2 text-xl font-black text-slate-950">
            {policy.fulfillmentDays}
          </p>
          <p className="mt-1 text-xs text-graphite-600">
            Working days, excluding public holidays
          </p>
        </div>
      </section>
      <div className="mt-8 space-y-9 text-sm leading-relaxed text-graphite-700">
        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            1. Processing and handling
          </h2>
          <p className="mt-3">
            Orders placed before {policy.cutoffTime} {policy.timezone} are
            queued for the current fulfillment day when the seller is operating.
            Orders after the cutoff, on a non-fulfillment day, or on a public
            holiday may begin processing on the next available fulfillment day.
          </p>
          <p className="mt-3">
            The handling time shown above is the database-backed dispatch
            estimate. It covers seller preparation and handover to the carrier;
            it is separate from transit time.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-black tracking-tight text-slate-950">
            2. Delivery coverage and carriers
          </h2>
          <p className="mt-3">
            {policy.delivery.regions}. We use reputed carriers such as{" "}
            {policy.delivery.carriers.join(", ")} when available. Carrier,
            service level, tracking, and final estimate may vary by seller, item
            dimensions, destination, and customs requirements.
          </p>
          <p className="mt-3">{policy.delivery.note}</p>
        </section>
        <section>
          <h2 className="font-display text-lg font-black tracking-tight text-slate-950">
            3. International orders and destination charges
          </h2>
          <p className="mt-3">
            {policy.duties} The buyer is responsible for accurate delivery
            information and destination-country import requirements. Customs
            delays are outside the carrier&apos;s standard transit estimate.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-black tracking-tight text-slate-950">
            4. Delivery issues
          </h2>
          <p className="mt-3">
            If tracking shows a problem, an item is damaged, or a package
            appears missing, contact support promptly with the order number and
            photographs. Do not discard damaged packaging before the carrier or
            seller reviews the claim.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-black tracking-tight text-slate-950">
            5. Related terms
          </h2>
          <p className="mt-3">
            Shipping does not change the{" "}
            <Link
              href="/return-policy"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Return Policy
            </Link>
            . For order questions, use{" "}
            <Link
              href="/support"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Customer Support
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
