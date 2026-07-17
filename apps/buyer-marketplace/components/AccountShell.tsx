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
    <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 border-b-2 border-slate-950 pb-4">
        <p className="eyebrow">Buyer account</p>
        <h1 className="mt-1 font-display text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          My PartsBazar
        </h1>
      </div>
      <div className="grid gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Account navigation" className="min-w-0">
          <nav className="-mx-4 flex max-w-[calc(100vw)] gap-1 overflow-x-auto border-y border-stone-300 bg-white px-4 py-2 lg:mx-0 lg:block lg:max-w-none lg:border-0 lg:bg-transparent lg:p-0">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === "/account" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-3 border-l-4 px-3 py-2.5 text-sm font-semibold transition-colors lg:mb-1",
                    active
                      ? "border-orange-500 bg-slate-950 text-white"
                      : "border-transparent text-slate-600 hover:bg-white hover:text-slate-950",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
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
