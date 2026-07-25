"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type NavItem } from "@repo/ui/app-shell";
import {
  GaugeIcon,
  ClipboardIcon,
  TagIcon,
  BoxIcon,
  UploadIcon,
  TruckIcon,
  StoreIcon,
} from "@repo/ui/icons";
import { DEMO_SELLER_NAME } from "@/lib/config";

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: GaugeIcon },
  { label: "Business onboarding", href: "/onboarding", icon: ClipboardIcon, matchPrefix: true },
  { label: "Pricing & terms", href: "/pricing", icon: TagIcon, matchPrefix: true },
  { label: "Inventory", href: "/inventory", icon: BoxIcon, matchPrefix: true },
  { label: "Upload pipeline", href: "/uploads", icon: UploadIcon, matchPrefix: true },
  { label: "Orders & fulfillment", href: "/orders", icon: TruckIcon, matchPrefix: true },
];

function SellerBadge() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-100 bg-brand-50 text-brand-700">
        <StoreIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{DEMO_SELLER_NAME}</p>
        <p className="text-xs text-graphite-600">Merchant account</p>
      </div>
    </div>
  );
}

/**
 * Seller chrome. The bespoke drawer this replaced worked, but had no focus
 * trap, no Escape handler, no safe-area padding, and used a fixed top bar that
 * every page had to offset with `pt-14`. The shared shell handles all of it.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell
      brand="PartsBazar"
      brandAccent="360"
      subtitle="Seller"
      nav={NAV_ITEMS}
      currentPath={pathname}
      LinkComponent={Link}
      navLabel="Seller navigation"
      account={<SellerBadge />}
    >
      {children}
    </AppShell>
  );
}
