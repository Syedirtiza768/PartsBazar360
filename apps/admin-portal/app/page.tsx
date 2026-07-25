import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { PageHeader } from "@repo/ui/page-header";
import { ArrowRightIcon } from "@repo/ui/icons";

const PORTALS = [
  {
    name: 'Buyer Marketplace',
    href: '/buyer/',
    description: 'Fitment-first shopping experience for end customers.',
    accent: 'text-blue-700 bg-blue-50 border-blue-100',
  },
  {
    name: 'Seller Portal',
    href: '/seller/',
    description: 'Inventory pricing, stock, uploads, and order fulfillment for merchants.',
    accent: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  },
  {
    name: 'Operations Portal',
    href: '/operations/',
    description: 'Checkout monitoring, seller upload exceptions, support, and fulfillment.',
    accent: 'text-amber-700 bg-amber-50 border-amber-100',
  },
  {
    name: 'Workshop Portal',
    href: '/workshop/',
    description: 'Tools for repair workshops and installers.',
    accent: 'text-violet-700 bg-violet-50 border-violet-100',
  },
];

const HEALTH_ITEMS = [
  { label: 'Marketplace status', value: 'Online', tone: 'text-emerald-700' },
  { label: 'Catalogue model', value: 'OEM + aftermarket', tone: 'text-slate-900' },
  { label: 'Seller intake', value: 'CSV pipeline live', tone: 'text-blue-700' },
  { label: 'Support routing', value: 'Operations desk', tone: 'text-amber-700' },
];

export default function Home() {
  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Platform admin"
        title="Marketplace control center"
        description="Govern portals, catalogue quality, seller readiness, and operational health."
        actions={
          <Link href="/catalog" className={buttonClasses()}>
            Open catalog queues
          </Link>
        }
      />

      {/* Two columns at the smallest sizes: a single column of four status
          tiles pushed the portal grid entirely below the fold on a phone. */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {HEALTH_ITEMS.map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <dt className="text-sm font-medium text-graphite-600">{item.label}</dt>
            <dd className={`mt-1.5 text-balance text-base font-bold sm:text-xl ${item.tone}`}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6 xl:col-span-2"
          aria-labelledby="portals-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="portals-heading" className="text-lg font-semibold text-slate-900">Portal access</h2>
              <p className="mt-1 text-sm text-graphite-600">
                Jump into the customer, seller, operations, or workshop experience.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-graphite-600">
              4 portals
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            {PORTALS.map((portal) => (
              <a
                key={portal.href}
                href={portal.href}
                className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-blue-200 hover:bg-white sm:p-5"
              >
                <span className={`inline-flex self-start rounded-full border px-2.5 py-1 text-xs font-semibold ${portal.accent}`}>
                  {portal.name}
                </span>
                <p className="mt-3 flex-1 text-pretty text-sm text-graphite-600">{portal.description}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:text-blue-600">
                  Open portal
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </a>
            ))}
          </div>
        </section>

        <section
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6"
          aria-labelledby="checklist-heading"
        >
          <h2 id="checklist-heading" className="text-lg font-semibold text-slate-900">Admin checklist</h2>
          <div className="mt-4 space-y-4">
            <ChecklistItem title="Catalogue governance" detail="Open Catalog queues to clear classification, OEM parse, and authenticity reviews." />
            <ChecklistItem title="Seller readiness" detail="Use upload review counts to identify sellers needing support." />
            <ChecklistItem title="Customer support" detail="Watch fitment and order tickets for escalation patterns." />
            <ChecklistItem title="Fulfillment health" detail="Keep pending seller orders visible to operations." />
          </div>
        </section>
      </div>
    </PageBody>
  );
}

function ChecklistItem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-pretty text-sm text-graphite-600">{detail}</p>
    </div>
  );
}
