import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms and Conditions | PartsBazar360",
  description:
    "General terms and conditions for using the PartsBazar360 marketplace and placing orders.",
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

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl gutter py-8 sm:py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">
          Buyer policies
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Terms and Conditions
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Effective date: August 2026 � PartsBazar360 is operated by Superior
          New &amp; Used Auto Spare Parts LLC.
        </p>
      </header>
      <div className="mt-8 space-y-9 text-sm leading-relaxed text-graphite-700">
        <Section number="1" title="About these terms">
          <p>
            These terms govern access to PartsBazar360 and use of its
            marketplace, account, support, checkout, and related services. By
            browsing, creating an account, or placing an order, you agree to
            these terms and the policies linked from this page.
          </p>
          <p>
            PartsBazar360 is owned and operated by Superior New &amp; Used Auto
            Spare Parts LLC, Trade License No. 2115291, Sajaa Scrap Market, Plot
            No. 6532-2, Emirates Industrial City, Sharjah, United Arab Emirates.
          </p>
        </Section>
        <Section number="2" title="Marketplace role">
          <p>
            PartsBazar360 connects buyers with sellers of new, used, OEM, and
            aftermarket automotive parts. Seller identity, condition, fitment
            evidence, price, availability, handling time, warranty, and
            item-specific terms should be reviewed before purchase. A listing is
            not a guarantee that a part will fit every vehicle variation.
          </p>
        </Section>
        <Section number="3" title="Accounts and buyer responsibilities">
          <p>
            Keep account credentials and delivery details accurate and
            confidential. You must be legally able to enter into a purchase
            contract and must not use another person&apos;s account, impersonate
            a person or business, or provide misleading information.
          </p>
          <p>
            Check the vehicle identification number, part number, dimensions,
            photos, condition, and seller notes before ordering. Ask for a
            fitment check when the application is uncertain.
          </p>
        </Section>
        <Section number="4" title="Listings, prices, and orders">
          <p>
            Listings are supplied by marketplace sellers and may change or
            become unavailable. Prices, taxes, shipping charges, and payment
            authorization are shown at checkout where applicable. We may correct
            an obvious error, reject an order, or request additional information
            before dispatch. An order is not accepted until payment is
            authorized and confirmed.
          </p>
        </Section>
        <Section number="5" title="Payment, shipping, and returns">
          <p>
            Payments are processed through the methods presented at checkout.
            See the{" "}
            <Link
              href="/shipping-policy"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Shipping Policy
            </Link>{" "}
            for the 2:00 PM GST cutoff and handling estimates, and the{" "}
            <Link
              href="/return-policy"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Return Policy
            </Link>{" "}
            for the 14-day return window and conditions.
          </p>
        </Section>
        <Section number="6" title="Acceptable use">
          <p>
            Do not interfere with the service, scrape or copy protected content
            without permission, upload malware, bypass security controls, submit
            fraudulent orders, misuse support, or use the platform for unlawful
            activity. We may suspend access or cancel activity that creates risk
            for buyers, sellers, or the marketplace.
          </p>
        </Section>
        <Section number="7" title="Content and intellectual property">
          <p>
            PartsBazar360 and its licensors retain rights in the website,
            branding, software, and original editorial content. Sellers retain
            responsibility for submitted content and grant the permissions
            needed to display listings. You may use the service for personal or
            internal purchasing purposes, subject to these terms.
          </p>
        </Section>
        <Section number="8" title="Disclaimers and liability">
          <p>
            Information may contain seller-supplied errors. To the extent
            permitted by applicable law, PartsBazar360 is not responsible for
            indirect, incidental, or consequential loss arising from a
            seller&apos;s item, vehicle application, carrier delay, customs
            event, or buyer installation decision. Nothing here excludes
            liability or consumer rights that cannot lawfully be excluded.
          </p>
        </Section>
        <Section number="9" title="Changes and governing law">
          <p>
            We may revise these terms by posting an updated effective date.
            Continued use after publication means the updated terms apply to
            future use and orders. These terms are intended to be governed by
            the laws of the United Arab Emirates and applicable laws of the
            Emirate of Sharjah, subject to mandatory consumer protections.
          </p>
        </Section>
        <Section number="10" title="Contact">
          <p>
            Questions can be sent to{" "}
            <a
              href="mailto:info@partsbazar360.com"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              info@partsbazar360.com
            </a>{" "}
            or raised through our{" "}
            <Link
              href="/contact"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Contact Us
            </Link>{" "}
            page. These general clauses should be reviewed by qualified UAE
            legal counsel before being treated as a final legal agreement.
          </p>
        </Section>
      </div>
    </div>
  );
}
