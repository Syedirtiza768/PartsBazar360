"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell, type NavItem } from "@repo/ui/app-shell";
import { Spinner } from "@repo/ui/spinner";
import { GaugeIcon, ClipboardIcon, ShieldIcon, GridIcon } from "@repo/ui/icons";
import { useAdminAuth } from "@/lib/auth-context";

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: GaugeIcon },
  { label: "Catalog queues", href: "/catalog", icon: ClipboardIcon, matchPrefix: true },
  { label: "Marketplace health", href: "/", icon: GridIcon },
  { label: "Operations", href: "/operations", icon: GridIcon },
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

export function AdminShell({ children }: { children: ReactNode }) {
  const { ready, isAdmin, user, logout } = useAdminAuth();
  const pathname = usePathname();
  const router = useRouter();
  // `trailingSlash: true` means the live path carries the slash.
  const isLogin = pathname === "/login" || pathname === "/login/";

  useEffect(() => {
    if (!ready || isLogin) return;
    if (!isAdmin) router.replace("/login");
  }, [ready, isAdmin, isLogin, router]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (!ready) return <AuthGate message="Checking admin session…" />;
  if (!isAdmin) return <AuthGate message="Redirecting to sign in…" />;

  const initial = (user?.name || user?.email || "A").charAt(0).toUpperCase();

  return (
    <AppShell
      brand="PartsBazar"
      brandAccent="360"
      subtitle="Admin console"
      nav={NAV_ITEMS}
      currentPath={pathname}
      LinkComponent={Link}
      navLabel="Admin navigation"
      account={
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-100 font-semibold text-blue-700">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {user?.name || "Platform Admin"}
            </p>
            <p className="truncate text-xs text-graphite-600">
              {user?.email || "admin@partsbazar360.com"}
            </p>
          </div>
        </div>
      }
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
