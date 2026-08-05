import type { Metadata } from "next";
import Link from "next/link";
import { MailIcon, MapPinIcon, MessageIcon, ShieldCheckIcon } from "@repo/ui/icons";

export const metadata: Metadata = {
  title: "Contact Us | PartsBazar360",
  description:
    "Contact PartsBazar360 — corporate information, registered office, and support channels for Superior New & Used Auto Spare Parts LLC.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-5xl gutter py-8 sm:py-12">
      <header>
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Contact Us
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-graphite-600 sm:text-base">
          Reach out to PartsBazar360 for orders, fitment checks, returns, or general inquiries.
        </p>
      </header>

      <section className="mt-8 rounded-xl border-2 border-slate-950 bg-white p-6 sm:p-8">
        <h2 className="font-display text-xl font-black uppercase tracking-tight text-slate-950 sm:text-2xl">
          Corporate Information &amp; Registered Office
        </h2>
        <dl className="mt-6 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Legal Entity Name
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                Superior New &amp; Used Auto Spare Parts LLC
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Brand Name
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">PartsBazar360</dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Trade License Number
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900 part-number">
                2115291
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Physical Address
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-slate-900">
                Sajaa Scrap Market, Plot No. 6532-2, Emirates Industrial City, Sharjah, United Arab
                Emirates
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MailIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Primary Contact Email
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                <a href="mailto:info@partsbazar360.com" className="hover:text-brand-600">
                  info@partsbazar360.com
                </a>
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-graphite-500">
                Phone Number
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                <a href="tel:+971564974989" className="hover:text-brand-600">
                  +971 56 497 4989
                </a>
              </dd>
            </div>
          </div>
        </dl>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/support"
          className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          <MessageIcon className="h-4 w-4" />
          Open a support ticket
        </Link>
        <a
          href="mailto:info@partsbazar360.com"
          className="inline-flex min-h-touch items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-900 hover:border-slate-300"
        >
          <MailIcon className="h-4 w-4" />
          Email us directly
        </a>
      </div>
    </div>
  );
}
