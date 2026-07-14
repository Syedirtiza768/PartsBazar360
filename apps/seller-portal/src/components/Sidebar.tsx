import Link from 'next/link';
import { DEMO_SELLER_NAME } from '@/lib/config';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'Upload Pipeline', href: '/uploads' },
  { label: 'Orders & Fulfillment', href: '/orders' },
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-white text-slate-700 border-r border-slate-200 h-screen flex flex-col shadow-sm">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">
          PartsBazar<span className="text-emerald-600">360</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Merchant OS</p>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-4">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-100 hover:text-slate-950 transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-200">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center font-semibold">
            M
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-slate-950 truncate">{DEMO_SELLER_NAME}</span>
            <span className="text-xs text-slate-500">Merchant Account</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
