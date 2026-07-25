"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type NavItem } from "@repo/ui/app-shell";
import { GaugeIcon, StoreIcon } from "@repo/ui/icons";

const NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/", icon: GaugeIcon },
  { label: "Seller Onboarding", href: "/sellers", icon: StoreIcon, matchPrefix: true },
];

function OperationsBadge() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-100 font-semibold text-amber-700">
        O
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">Operations Team</p>
        <p className="truncate text-xs text-graphite-600">ops@partsbazar360.com</p>
      </div>
    </div>
  );
}

/**
 * Operations chrome. Replaces a bare `w-64 h-screen` rail that had no
 * breakpoint at all and left 64px of usable width on a 320px screen; the
 * shared shell collapses it to a top bar + drawer below `lg`.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell
      brand="PartsBazar"
      brandAccent="360"
      subtitle="Operations"
      nav={NAV_ITEMS}
      currentPath={pathname}
      LinkComponent={Link}
      navLabel="Operations navigation"
      account={<OperationsBadge />}
    >
      {children}
    </AppShell>
  );
}
