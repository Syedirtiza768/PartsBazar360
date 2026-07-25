"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CarIcon,
  HeartIcon,
  MessageIcon,
  ReceiptIcon,
  RotateCcwIcon,
  SettingsIcon,
  UserIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";

const LINKS = [
  { href: "/account", label: "Overview", icon: UserIcon },
  { href: "/account/purchases", label: "Purchases", icon: ReceiptIcon },
  { href: "/watchlist", label: "Watchlist", icon: HeartIcon },
  { href: "/garage", label: "Garage", icon: CarIcon },
  { href: "/account/messages", label: "Messages", icon: MessageIcon },
  { href: "/account/returns", label: "Returns & issues", icon: RotateCcwIcon },
  { href: "/account/settings", label: "Settings", icon: SettingsIcon },
];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-wide gutter py-7 lg:py-10">
      <div className="mb-6 border-b-2 border-graphite-950 pb-4">
        <p className="eyebrow">Buyer account</p>
        <h1 className="mt-1 font-display text-display-sm font-black tracking-tight text-graphite-950">
          My PartsBazar
        </h1>
      </div>
      <div className="grid gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Account navigation" className="min-w-0">
          <nav className="scroll-rail gap-1 border-y border-stone-300 bg-white py-2 lg:block lg:overflow-visible lg:border-0 lg:bg-transparent lg:py-0">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === "/account" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-touch shrink-0 items-center gap-3 whitespace-nowrap border-l-4 px-3 py-2.5 text-sm font-semibold transition-colors lg:mb-1 lg:whitespace-normal",
                    active
                      ? "border-signal-500 bg-graphite-950 text-white"
                      : "border-transparent text-graphite-700 hover:bg-white hover:text-graphite-950",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
