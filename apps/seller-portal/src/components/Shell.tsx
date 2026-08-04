"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell, type NavItem } from "@repo/ui/app-shell";
import { Spinner } from "@repo/ui/spinner";
import {
  GaugeIcon,
  ClipboardIcon,
  TagIcon,
  BoxIcon,
  UploadIcon,
  TruckIcon,
  StoreIcon,
} from "@repo/ui/icons";
import { useSellerAuth } from "@/lib/auth-context";

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: GaugeIcon },
  { label: "Business onboarding", href: "/onboarding", icon: ClipboardIcon, matchPrefix: true },
  { label: "Pricing & terms", href: "/pricing", icon: TagIcon, matchPrefix: true },
  { label: "Inventory", href: "/inventory", icon: BoxIcon, matchPrefix: true },
  { label: "Upload pipeline", href: "/uploads", icon: UploadIcon, matchPrefix: true },
  { label: "Orders & fulfillment", href: "/orders", icon: TruckIcon, matchPrefix: true },
];

/** Centred, responsive status screen for the pre-authenticated states. */
function AuthGate({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gutter py-16 text-center">
      <Spinner />
      <p className="mt-4 text-sm text-graphite-600">{message}</p>
    </div>
  );
}

function SellerBadge({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-100 bg-brand-50 text-brand-700">
        <StoreIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
        <p className="truncate text-xs text-graphite-600">{email}</p>
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
  const { ready, isSeller, user, sellerName, logout } = useSellerAuth();
  const pathname = usePathname();
  const router = useRouter();
  // `trailingSlash: true` means the live path carries the slash.
  const isLogin = pathname === "/login" || pathname === "/login/";

  useEffect(() => {
    if (!ready || isLogin) return;
    if (!isSeller) router.replace("/login");
  }, [ready, isSeller, isLogin, router]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (!ready) return <AuthGate message="Checking seller session…" />;
  if (!isSeller) return <AuthGate message="Redirecting to sign in…" />;

  return (
    <AppShell
      brand="PartsBazar"
      brandAccent="360"
      subtitle="Seller"
      nav={NAV_ITEMS}
      currentPath={pathname}
      LinkComponent={Link}
      navLabel="Seller navigation"
      account={<SellerBadge name={sellerName || "Seller"} email={user?.email || user?.phone || ""} />}
      accountActions={
        <button
          type="button"
          onClick={logout}
          className="w-full touch-target rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Sign out
        </button>
      }
    >
      {children}
    </AppShell>
  );
}
