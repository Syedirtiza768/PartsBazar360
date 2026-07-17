import Link from "next/link";
import {
  ShieldCheckIcon,
  TruckIcon,
  RotateCcwIcon,
  MessageIcon,
} from "@repo/ui/icons";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      { href: "/search", label: "All parts" },
      { href: "/garage", label: "Find by vehicle" },
      { href: "/search?category=Engine", label: "Engine parts" },
      { href: "/search?category=Body", label: "Body parts" },
      { href: "/search?category=Electrical", label: "Electrical" },
    ],
  },
  {
    title: "Your account",
    links: [
      { href: "/garage", label: "My Garage" },
      { href: "/cart", label: "Cart" },
      { href: "/support", label: "Order help" },
    ],
  },
  {
    title: "Help & trust",
    links: [
      { href: "/support", label: "Contact support" },
      { href: "/support", label: "Fitment verification" },
      { href: "/support", label: "Returns & refunds" },
      { href: "/support", label: "Shipping questions" },
    ],
  },
];

const TRUST_ITEMS = [
  {
    icon: <ShieldCheckIcon className="h-5 w-5 text-emerald-400" />,
    title: "Fitment-verified",
    desc: "Structured compatibility evidence on every verified listing",
  },
  {
    icon: <TruckIcon className="h-5 w-5 text-emerald-400" />,
    title: "Worldwide shipping",
    desc: "Real weight-based rates from every seller",
  },
  {
    icon: <RotateCcwIcon className="h-5 w-5 text-emerald-400" />,
    title: "Seller return policies",
    desc: "Return windows shown before you buy",
  },
  {
    icon: <MessageIcon className="h-5 w-5 text-emerald-400" />,
    title: "Human support",
    desc: "Compatibility questions answered by our team",
  },
];

export function Footer() {
  return (
    <footer className="bg-graphite-950 text-slate-400">
      {/* Trust strip */}
      <div className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Link columns */}
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 md:grid-cols-5 lg:px-8">
        <div className="col-span-2">
          <p className="text-xl font-black tracking-tight text-white">
            PartsBazar<span className="text-brand-400">360</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed">
            Fitment-verified used &amp; OEM auto parts, sourced live from vetted
            marketplace sellers worldwide.
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
            <ShieldCheckIcon className="h-4 w-4 text-emerald-400" />
            Every listing discloses condition, source, and fitment evidence.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3 className="text-sm font-semibold text-white">{col.title}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={`${col.title}-${link.label}`}>
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} PartsBazar360. All rights reserved.</p>
          <p>Prices shown in each seller&apos;s listing currency.</p>
        </div>
      </div>
    </footer>
  );
}
