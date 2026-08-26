import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Return Policy | PartsBazar360",
  description:
    "PartsBazar360 returns policy, including the 14-day return window and refund process.",
};

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
        {number}. {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function ReturnPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl gutter py-8 sm:py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">
          Buyer policies
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Return Policy
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Effective date: August 2026 � Operated by Superior New &amp; Used Auto
          Spare Parts LLC
        </p>
      </header>
      <div className="mt-8 space-y-9 text-sm leading-relaxed text-graphite-700">
        <section className="rounded-xl border-2 border-brand-200 bg-brand-50 p-5 sm:p-6">
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            14-day return window
          </h2>
          <p className="mt-3 text-graphite-800">
            We accept eligible returns requested within 14 calendar days of
            delivery. Seller-specific terms shown on a listing or at checkout
            apply alongside this marketplace policy.
          </p>
        </section>
        <Section number="1" title="Eligibility">
          <p>
            Contact us before sending an item back so we can record the order,
            confirm the reason, and provide instructions. Items must be the item
            purchased, unused or in the same condition received, and accompanied
            by original packaging, tags, accessories, and documentation where
            applicable.
          </p>
          <p>
            Fitment-related returns should include the vehicle identification
            number and the fitment information used when ordering. A fitment
            check helps us investigate, but does not replace the buyer&apos;s
            responsibility to verify the final application.
          </p>
        </Section>
        <Section number="2" title="Items that may not qualify">
          <p>
            Returns may be refused or adjusted for installed, altered, damaged,
            incomplete, used, contaminated, or incorrectly assembled items;
            parts damaged after delivery; and specially ordered, modified, or
            clearly marked non-returnable items. This does not limit rights that
            cannot lawfully be excluded.
          </p>
        </Section>
        <Section number="3" title="Inspection and refund">
          <p>
            The seller or PartsBazar360 may inspect the item after it arrives.
            If approved, the refund is issued to the original payment method
            after inspection, less any disclosed deductions permitted by the
            listing or applicable law. Original shipping charges and return
            shipping follow the reason for return, seller terms, and applicable
            carrier or payment rules.
          </p>
        </Section>
        <Section number="4" title="How to start a return">
          <p>
            Open a request from our{" "}
            <Link
              href="/support?category=RETURNS"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Returns &amp; refunds support page
            </Link>
            , or contact us with the order number, item, reason, and photographs
            where useful. Keep the item safely packaged until instructions are
            confirmed.
          </p>
        </Section>
        <Section number="5" title="Marketplace and seller responsibility">
          <p>
            PartsBazar360 provides the marketplace, checkout, and support
            workflow. The seller remains responsible for accurate item
            condition, dispatch, and seller-specific warranty or return
            promises. We may help coordinate a resolution when a seller does not
            respond or a listing materially differs from its description.
          </p>
        </Section>
        <Section number="6" title="Changes and contact">
          <p>
            We may update this policy by posting a revised effective date.
            Contact{" "}
            <a
              href="mailto:info@partsbazar360.com"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              info@partsbazar360.com
            </a>{" "}
            or use our{" "}
            <Link
              href="/contact"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Contact Us
            </Link>{" "}
            page.
          </p>
        </Section>
      </div>
    </div>
  );
}
