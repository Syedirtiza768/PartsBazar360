import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheckIcon } from "@repo/ui/icons";

export const metadata: Metadata = {
  title: "Privacy Policy | PartsBazar360",
  description:
    "PartsBazar360 privacy policy — how Superior New & Used Auto Spare Parts LLC collects, uses, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl gutter py-8 sm:py-12">
      <header>
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Effective date: August 2026 &middot; Operated by Superior New &amp; Used Auto Spare Parts
          LLC
        </p>
      </header>

      <div className="mt-8 space-y-10 text-sm leading-relaxed text-graphite-700">
        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            1. Who we are
          </h2>
          <p className="mt-3">
            PartsBazar360 is a motor-parts marketplace owned and operated by{" "}
            <strong>Superior New &amp; Used Auto Spare Parts LLC</strong> (Trade License No.
            2115291), registered at Sajaa Scrap Market, Plot No. 6532-2, Emirates Industrial City,
            Sharjah, United Arab Emirates. References to &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
            &ldquo;our&rdquo; in this policy refer to this entity.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            2. Information we collect
          </h2>
          <p className="mt-3">
            We collect information you provide directly — name, email address, phone number, shipping
            address, vehicle details, and order information — when you create an account, place an
            order, open a support ticket, or communicate with us. We also collect standard technical
            data (IP address, browser type, device identifiers, pages visited) through cookies and
            server logs.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            3. How we use your information
          </h2>
          <p className="mt-3">
            We use personal information to fulfil orders, provide fitment verification, process
            payments, manage returns, respond to support requests, send transactional notifications
            (including SMS), prevent fraud, and comply with legal obligations under UAE law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            4. Information sharing
          </h2>
          <p className="mt-3">
            We share information only with service providers who support our operations (payment
            processors, shipping carriers, hosting providers) under contractual confidentiality
            obligations. We do not sell, rent, or trade personal information to third parties for
            their own marketing purposes.
          </p>
        </section>

        <section className="rounded-xl border-2 border-brand-200 bg-brand-50 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" />
            <div>
              <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
                5. SMS Communication &amp; Messaging Policy
              </h2>
              <p className="mt-3 text-graphite-800">
                PartsBazar360 (operated by Superior New &amp; Used Auto Spare Parts LLC) respects
                your privacy. Mobile numbers collected for SMS notifications, order updates, or
                customer support will strictly be used for transactional and requested service
                communications. We do not sell, rent, share, or disclose customer phone numbers or
                SMS opt-in data to third parties, affiliates, or marketing agencies for promotional
                purposes.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            6. Data security
          </h2>
          <p className="mt-3">
            We implement reasonable administrative, technical, and physical safeguards to protect
            personal information against unauthorised access, alteration, disclosure, or destruction.
            No method of transmission or storage is completely secure; we cannot guarantee absolute
            security.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            7. Data retention
          </h2>
          <p className="mt-3">
            We retain personal information for as long as necessary to provide our services, comply
            with legal obligations, resolve disputes, and enforce agreements. Order and transaction
            records are retained for the period required by applicable UAE commercial regulations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            8. Your rights
          </h2>
          <p className="mt-3">
            You may request access to, correction of, or deletion of your personal data by
            contacting us at{" "}
            <a href="mailto:info@partsbazar360.com" className="font-semibold text-brand-600 hover:text-brand-700">
              info@partsbazar360.com
            </a>
            . We will respond to verified requests within a reasonable timeframe.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            9. Changes to this policy
          </h2>
          <p className="mt-3">
            We may update this policy from time to time. The effective date at the top of this page
            indicates when the policy was last revised. Continued use of PartsBazar360 after changes
            are posted constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-slate-950">
            10. Contact us
          </h2>
          <p className="mt-3">
            For questions about this policy or your personal data, contact{" "}
            <strong>Superior New &amp; Used Auto Spare Parts LLC</strong> at{" "}
            <a href="mailto:info@partsbazar360.com" className="font-semibold text-brand-600 hover:text-brand-700">
              info@partsbazar360.com
            </a>{" "}
            or visit our{" "}
            <Link href="/contact" className="font-semibold text-brand-600 hover:text-brand-700">
              Contact Us
            </Link>{" "}
            page for full corporate details.
          </p>
        </section>
      </div>
    </div>
  );
}
