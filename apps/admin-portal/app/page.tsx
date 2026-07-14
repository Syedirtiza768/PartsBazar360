const PORTALS = [
  {
    name: 'Buyer Marketplace',
    href: '/buyer/',
    description: 'Fitment-first shopping experience for end customers.',
    accent: 'from-blue-400 to-cyan-400',
  },
  {
    name: 'Seller Portal',
    href: '/seller/',
    description: 'Inventory pricing, stock, and order fulfillment for merchants.',
    accent: 'from-emerald-400 to-teal-400',
  },
  {
    name: 'Operations Portal',
    href: '/operations/',
    description: 'Trigger and monitor marketplace catalogue sync jobs.',
    accent: 'from-amber-400 to-orange-400',
  },
  {
    name: 'Workshop Portal',
    href: '/workshop/',
    description: 'Tools for repair workshops and installers.',
    accent: 'from-purple-400 to-pink-400',
  },
];

export default function Home() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
        <p className="text-zinc-400 mt-1">Jump into any of the PartsBazar360 portals below.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {PORTALS.map((portal) => (
          <a
            key={portal.href}
            href={portal.href}
            className="group bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 backdrop-blur-sm hover:border-zinc-700 transition-colors"
          >
            <h3 className={`text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r ${portal.accent}`}>
              {portal.name}
            </h3>
            <p className="text-sm text-zinc-400 mt-2">{portal.description}</p>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-zinc-300 mt-4 group-hover:translate-x-1 transition-transform">
              Open portal →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
