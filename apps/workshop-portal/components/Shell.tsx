"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type NavItem } from "@repo/ui/app-shell";
import { GaugeIcon } from "@repo/ui/icons";

const NAV_ITEMS: NavItem[] = [{ label: "Overview", href: "/", icon: GaugeIcon }];

function WorkshopBadge() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 font-semibold text-zinc-200">
        W
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">Workshop Partner</p>
        <p className="truncate text-xs text-zinc-500">workshop@partsbazar360.com</p>
      </div>
    </div>
  );
}

/** Workshop chrome — the same shared shell as the other portals, dark tone. */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell
      brand="PartsBazar"
      brandAccent="360"
      subtitle="Workshop"
      nav={NAV_ITEMS}
      currentPath={pathname}
      LinkComponent={Link}
      tone="dark"
      navLabel="Workshop navigation"
      account={<WorkshopBadge />}
    >
      {children}
    </AppShell>
  );
}
