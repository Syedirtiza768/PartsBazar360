import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      { href: '/search', label: 'All Parts' },
      { href: '/', label: 'Find by Vehicle' },
      { href: '/garage', label: 'My Garage' },
    ],
  },
  {
    title: 'Categories',
    links: [
      { href: '/search?category=Engine', label: 'Engine' },
      { href: '/search?category=Transmission', label: 'Transmission' },
      { href: '/search?category=Brakes', label: 'Brakes' },
      { href: '/search?category=Body', label: 'Body' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/cart', label: 'Cart' },
      { href: '/checkout', label: 'Checkout' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-2 sm:grid-cols-4 gap-8">
        <div className="col-span-2 sm:col-span-1">
          <p className="text-xl font-black text-white tracking-tight">
            PartsBazar<span className="text-emerald-500">360</span>
          </p>
          <p className="mt-3 text-sm text-slate-400 max-w-xs">
            Fitment-verified used &amp; OEM auto parts, sourced live from vetted marketplace sellers worldwide.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="text-sm font-semibold text-white">{col.title}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white transition-colors">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} PartsBazar360. All rights reserved.
      </div>
    </footer>
  );
}
