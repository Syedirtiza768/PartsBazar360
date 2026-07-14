import Link from 'next/link';

const NAV_ITEMS = [{ label: 'Command Center', href: '/' }];

export function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-950 text-zinc-300 border-r border-zinc-800 h-screen flex flex-col">
      <div className="p-6">
        <h2 className="text-2xl font-bold text-white tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-400">
          PartsBazar360
        </h2>
        <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Operations</p>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center px-4 py-3 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors font-medium"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">O</div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white">Operations Team</span>
            <span className="text-xs text-zinc-500">ops@partsbazar360.com</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
