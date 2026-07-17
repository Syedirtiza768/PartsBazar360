"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@repo/ui/cn";
import {
  GaugeIcon,
  ClipboardIcon,
  TagIcon,
  BoxIcon,
  UploadIcon,
  TruckIcon,
  MenuIcon,
  XIcon,
  StoreIcon,
} from "@repo/ui/icons";
import { DEMO_SELLER_NAME } from "@/lib/config";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: GaugeIcon },
  { label: "Business onboarding", href: "/onboarding", icon: ClipboardIcon },
  { label: "Pricing & terms", href: "/pricing", icon: TagIcon },
  { label: "Inventory", href: "/inventory", icon: BoxIcon },
  { label: "Upload pipeline", href: "/uploads", icon: UploadIcon },
  { label: "Orders & fulfillment", href: "/orders", icon: TruckIcon },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5 px-3" aria-label="Seller navigation">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand-600" : "text-slate-400")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SellerBadge() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-100 bg-brand-50 text-brand-700">
        <StoreIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{DEMO_SELLER_NAME}</p>
        <p className="text-xs text-slate-500">Merchant account</p>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <p className="text-xl font-black tracking-tight text-slate-900">
      PartsBazar<span className="text-brand-600">360</span>
      <span className="ml-2 align-middle rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Seller
      </span>
    </p>
  );
}

/** Responsive seller shell: fixed sidebar ≥lg, top bar + drawer below. */
export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-100 px-6 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <NavLinks />
        </div>
        <div className="border-t border-slate-100 p-4">
          <SellerBadge />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-graphite-950/50 backdrop-blur-[2px] animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-overlay animate-slide-in-left">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-slate-100 p-4">
              <SellerBadge />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main>
    </div>
  );
}
