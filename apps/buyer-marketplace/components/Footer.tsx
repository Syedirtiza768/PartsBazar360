import Link from "next/link";
import { CarIcon, MessageIcon, ShieldCheckIcon, StoreIcon, TruckIcon } from "@repo/ui/icons";

const GROUPS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: "Shop",
    links: [
      ["/search", "All parts"],
      ["/search?category=Suspension", "Suspension"],
      ["/search?category=Brakes", "Brakes"],
      ["/search?category=Engine", "Engine"],
      ["/search?brand=FEBEST", "FEBEST parts"],
    ],
  },
  {
    title: "My PartsBazar",
    links: [
      ["/account", "Account overview"],
      ["/account/purchases", "Purchases"],
      ["/garage", "My garage"],
      ["/watchlist", "Watchlist"],
    ],
  },
  {
    title: "Company",
    links: [
      ["/contact", "Contact us"],
      ["/privacy-policy", "Privacy policy"],
    ],
  },
  {
    title: "Help",
    links: [
      ["/support", "Customer support"],
      ["/support?category=FITMENT", "Fitment check"],
      ["/support?category=ORDER_ISSUE", "Order issue"],
      ["/support?category=RETURNS", "Returns & refunds"],
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-graphite-950 bg-graphite-950 text-slate-300">
      <div className="border-b border-white/15">
        <div className="mx-auto grid max-w-wide sm:grid-cols-3">
          {[
            [CarIcon, "Vehicle context", "Fitment follows the buyer journey"],
            [StoreIcon, "Marketplace sellers", "Seller identity and terms stay visible"],
            [TruckIcon, "Separate shipments", "Delivery and returns remain seller-specific"],
          ].map(([Icon, title, description]) => { const ItemIcon = Icon as typeof CarIcon; return <div key={title as string} className="flex gap-3 border-b border-white/15 gutter py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><ItemIcon className="h-5 w-5 shrink-0 text-brand-300" /><div><p className="text-sm font-bold text-white">{title as string}</p><p className="mt-0.5 text-xs text-slate-400">{description as string}</p></div></div>; })}
        </div>
      </div>
      <div className="mx-auto grid max-w-wide gap-8 gutter py-10 sm:gap-10 md:grid-cols-[1.25fr_2fr] lg:py-12">
        <div>
          <p className="font-display text-2xl font-black uppercase tracking-tight text-white">PartsBazar360</p>
          <p className="mt-3 max-w-sm text-pretty text-sm leading-relaxed text-slate-400">A motor-parts marketplace built around compatibility evidence, honest condition, and clear seller responsibility.</p>
          <Link href="/support" className="mt-4 inline-flex min-h-touch items-center gap-2 text-sm font-bold text-brand-200 hover:text-white"><MessageIcon className="h-4 w-4" />Get help from a human</Link>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
          {GROUPS.map((group) => <nav key={group.title} aria-label={group.title}><p className="text-[11px] font-black uppercase tracking-[0.18em] text-white">{group.title}</p><ul className="mt-3 space-y-2.5">{group.links.map(([href, label]) => <li key={href}><Link href={href} className="flex min-h-9 items-center text-sm text-slate-400 hover:text-white">{label}</Link></li>)}</ul></nav>)}
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-wide flex-col gap-3 gutter py-4 pb-safe-b-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between"><p>© {new Date().getFullYear()} PartsBazar360. All rights reserved. PartsBazar360 is owned and operated by Superior New &amp; Used Auto Spare Parts LLC (Trade License No. 2115291).</p><p className="flex items-start gap-2"><ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />Compatibility uncertainty is labeled, never hidden.</p></div>
      </div>
    </footer>
  );
}
