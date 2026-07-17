import Link from "next/link";
import { CarIcon, MessageIcon, ShieldCheckIcon, StoreIcon, TruckIcon } from "@repo/ui/icons";

const GROUPS: Array<{ title: string; links: Array<[string, string]> }> = [
  { title: "Shop", links: [["/search", "All parts"], ["/garage", "Shop by vehicle"], ["/watchlist", "Watchlist"], ["/cart", "Cart"]] },
  { title: "My PartsBazar", links: [["/account", "Account overview"], ["/account/purchases", "Purchases"], ["/account/messages", "Messages"], ["/account/returns", "Returns & issues"]] },
  { title: "Help", links: [["/support", "Customer support"], ["/support?category=FITMENT", "Fitment check"], ["/support?category=ORDER_ISSUE", "Order issue"], ["/support?category=RETURNS", "Returns & refunds"]] },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-slate-950 bg-graphite-950 text-slate-300">
      <div className="border-b border-white/15">
        <div className="mx-auto grid max-w-[1440px] sm:grid-cols-3">
          {[
            [CarIcon, "Vehicle context", "Fitment follows the buyer journey"],
            [StoreIcon, "Marketplace sellers", "Seller identity and terms stay visible"],
            [TruckIcon, "Separate shipments", "Delivery and returns remain seller-specific"],
          ].map(([Icon, title, description]) => { const ItemIcon = Icon as typeof CarIcon; return <div key={title as string} className="flex gap-3 border-b border-white/15 px-4 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-6 lg:px-8"><ItemIcon className="h-5 w-5 shrink-0 text-brand-300" /><div><p className="text-sm font-bold text-white">{title as string}</p><p className="mt-0.5 text-xs text-slate-400">{description as string}</p></div></div>; })}
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-10 sm:px-6 md:grid-cols-[1.25fr_2fr] lg:px-8 lg:py-12">
        <div>
          <p className="font-display text-2xl font-black uppercase tracking-tight text-white">PartsBazar360</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">A motor-parts marketplace built around compatibility evidence, honest condition, and clear seller responsibility.</p>
          <Link href="/support" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-200 hover:text-white"><MessageIcon className="h-4 w-4" />Get help from a human</Link>
        </div>
        <div className="grid grid-cols-2 gap-7 sm:grid-cols-3">
          {GROUPS.map((group) => <nav key={group.title} aria-label={group.title}><p className="text-[11px] font-black uppercase tracking-[0.18em] text-white">{group.title}</p><ul className="mt-3 space-y-2.5">{group.links.map(([href, label]) => <li key={href}><Link href={href} className="text-sm text-slate-400 hover:text-white">{label}</Link></li>)}</ul></nav>)}
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"><p>© {new Date().getFullYear()} PartsBazar360</p><p className="flex items-center gap-2"><ShieldCheckIcon className="h-4 w-4 text-brand-300" />Compatibility uncertainty is labeled, never hidden.</p></div>
      </div>
    </footer>
  );
}
