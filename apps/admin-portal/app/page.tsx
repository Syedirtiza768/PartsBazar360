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
  { label: 'Catalogue model', value: 'OEM + aftermarket', tone: 'text-slate-950' },
  { label: 'Seller intake', value: 'CSV pipeline live', tone: 'text-blue-700' },
  { label: 'Support routing', value: 'Operations desk', tone: 'text-amber-700' },
];

export default function Home() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Platform Admin</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Marketplace control center</h1>
          <p className="text-slate-600 mt-1">Govern portals, catalogue quality, seller readiness, and operational health.</p>
        </div>
        <a href="/catalog" className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
          Open catalog queues
        </a>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {HEALTH_ITEMS.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-medium text-slate-500">{item.label}</h3>
            <p className={`mt-2 text-xl font-bold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Portal access</h2>
              <p className="mt-1 text-sm text-slate-500">Jump into the customer, seller, operations, or workshop experience.</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              4 portals
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {PORTALS.map((portal) => (
              <a
                key={portal.href}
                href={portal.href}
                className="group rounded-lg border border-slate-200 bg-slate-50 p-5 hover:bg-white hover:border-blue-200 transition-colors"
              >
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${portal.accent}`}>
                  {portal.name}
                </span>
                <p className="text-sm text-slate-600 mt-3">{portal.description}</p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 mt-4 group-hover:text-blue-600">
                  Open portal
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Admin checklist</h2>
          <div className="mt-5 space-y-4">
            <ChecklistItem title="Catalogue governance" detail="Open Catalog queues to clear classification, OEM parse, and authenticity reviews." />
            <ChecklistItem title="Seller readiness" detail="Use upload review counts to identify sellers needing support." />
            <ChecklistItem title="Customer support" detail="Watch fitment and order tickets for escalation patterns." />
            <ChecklistItem title="Fulfillment health" detail="Keep pending seller orders visible to operations." />
          </div>
        </section>
      </div>
    </div>
  );
}

function ChecklistItem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  );
}
