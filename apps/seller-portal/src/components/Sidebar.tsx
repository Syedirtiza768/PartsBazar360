import Link from 'next/link';
import { DEMO_SELLER_NAME } from '@/lib/config';

export function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-950 text-zinc-300 border-r border-zinc-800 h-screen flex flex-col transition-all duration-300">
      <div className="p-6">
        <h2 className="text-2xl font-bold text-white tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          PartsBazar360
        </h2>
        <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Merchant OS</p>
      </div>
      
      <nav className="flex-1 px-4 space-y-2 mt-4">
        <Link href="/" className="flex items-center px-4 py-3 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors group">
          <span className="font-medium group-hover:translate-x-1 transition-transform">Dashboard</span>
        </Link>
        <Link href="/inventory" className="flex items-center px-4 py-3 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors group">
          <span className="font-medium group-hover:translate-x-1 transition-transform">Inventory</span>
        </Link>
        <Link href="/uploads" className="flex items-center px-4 py-3 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors group">
          <span className="font-medium group-hover:translate-x-1 transition-transform">Upload Pipeline</span>
        </Link>
        <Link href="/orders" className="flex items-center px-4 py-3 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors group">
          <span className="font-medium group-hover:translate-x-1 transition-transform">Orders & Fulfillment</span>
        </Link>
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            M
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white">{DEMO_SELLER_NAME}</span>
            <span className="text-xs text-zinc-500">Merchant Account</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
