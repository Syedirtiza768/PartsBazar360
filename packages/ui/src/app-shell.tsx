"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "./cn";
import { MenuIcon } from "./icons";
import { Sheet } from "./sheet";
import type { IconProps } from "./icons";

/**
 * Shared chrome for the operator-facing portals (seller, admin, operations,
 * workshop).
 *
 * All four previously rendered `<aside class="w-64 h-screen">` next to `<main>`
 * with no breakpoints at all: on a 320px screen the nav consumed 256px and left
 * 64px for the page, so every one of them was unusable on a phone. This shell
 * gives them one implementation — sticky rail from `lg`, top bar + drawer
 * below — so the fix cannot drift apart again.
 *
 * `LinkComponent` is injected rather than imported so this package keeps no
 * framework dependency; each app passes its own router-aware link.
 */

export type NavLinkComponent = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  "aria-current"?: "page";
}>;

export interface NavItem {
  label: string;
  href: string;
  icon?: ComponentType<IconProps>;
  /** Match on prefix rather than exact equality (for section landing pages). */
  matchPrefix?: boolean;
}

export type ShellTone = "light" | "dark";

export interface AppShellProps {
  /** Product name; the trailing accent segment is coloured. */
  brand: string;
  brandAccent?: string;
  /** Small caps label under the brand, e.g. "Admin console". */
  subtitle?: string;
  nav: readonly NavItem[];
  currentPath: string;
  LinkComponent: NavLinkComponent;
  /** Identity card pinned to the bottom of the rail and drawer. */
  account?: ReactNode;
  /** Extra controls under the account card, e.g. a sign-out button. */
  accountActions?: ReactNode;
  tone?: ShellTone;
  navLabel?: string;
  children: ReactNode;
}

const TONE = {
  light: {
    surface: "bg-white border-slate-200",
    divider: "border-slate-100",
    brand: "text-slate-900",
    accent: "text-brand-600",
    subtitle: "text-graphite-600",
    idle: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    active: "bg-brand-50 text-brand-700",
    activeIcon: "text-brand-600",
    idleIcon: "text-slate-400",
    trigger: "text-slate-700 hover:bg-slate-100",
  },
  dark: {
    surface: "bg-zinc-950 border-zinc-800",
    divider: "border-zinc-800",
    brand: "text-white",
    accent: "text-purple-400",
    subtitle: "text-zinc-500",
    idle: "text-zinc-400 hover:bg-zinc-800 hover:text-white",
    active: "bg-zinc-800 text-white",
    activeIcon: "text-purple-400",
    idleIcon: "text-zinc-500",
    trigger: "text-zinc-300 hover:bg-zinc-800",
  },
} satisfies Record<ShellTone, Record<string, string>>;

function isActive(item: NavItem, currentPath: string) {
  // Next's `trailingSlash: true` means the live path is "/inventory/", so
  // compare on a normalised form rather than raw equality.
  const normalise = (value: string) => value.replace(/\/+$/, "") || "/";
  const here = normalise(currentPath);
  const target = normalise(item.href);
  if (item.matchPrefix && target !== "/") return here === target || here.startsWith(`${target}/`);
  return here === target;
}

function NavList({
  nav,
  currentPath,
  LinkComponent,
  tone,
  onNavigate,
  label,
}: {
  nav: readonly NavItem[];
  currentPath: string;
  LinkComponent: NavLinkComponent;
  tone: ShellTone;
  onNavigate?: () => void;
  label: string;
}) {
  const t = TONE[tone];
  return (
    <nav className="space-y-0.5 px-3" aria-label={label}>
      {nav.map((item) => {
        const active = isActive(item, currentPath);
        const Icon = item.icon;
        return (
          <LinkComponent
            key={`${item.href}-${item.label}`}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              // min-h-touch, not a fixed height: the label wraps on narrow
              // drawers rather than being clipped.
              "flex min-h-touch items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? t.active : t.idle,
            )}
          >
            {Icon && (
              <Icon
                className={cn("h-[18px] w-[18px] shrink-0", active ? t.activeIcon : t.idleIcon)}
              />
            )}
            <span className="min-w-0 flex-1">{item.label}</span>
          </LinkComponent>
        );
      })}
    </nav>
  );
}

export function AppShell({
  brand,
  brandAccent,
  subtitle,
  nav,
  currentPath,
  LinkComponent,
  account,
  accountActions,
  tone = "light",
  navLabel = "Portal navigation",
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const t = TONE[tone];

  // Route changes must close the drawer, or the next page renders behind it.
  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  const Brand = (
    <div className="min-w-0">
      <p className={cn("truncate text-lg font-black tracking-tight", t.brand)}>
        {brand}
        {brandAccent && <span className={t.accent}>{brandAccent}</span>}
      </p>
      {subtitle && (
        <p className={cn("mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider", t.subtitle)}>
          {subtitle}
        </p>
      )}
    </div>
  );

  const railFooter = (account || accountActions) && (
    <div className={cn("space-y-3 border-t p-4 pb-safe-b-4", t.divider)}>
      {account}
      {accountActions}
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop rail. `h-dvh` + sticky keeps the nav in view without the
          `h-screen` overshoot that leaves a dead strip under mobile chrome. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r xl:w-72 lg:flex",
          t.surface,
        )}
      >
        <div className={cn("border-b px-5 py-4 pt-safe", t.divider)}>{Brand}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none-y py-4">
          <NavList {...{ nav, currentPath, LinkComponent, tone, label: navLabel }} />
        </div>
        {railFooter}
      </aside>

      {/* Mobile bar. Sticky rather than fixed, so it participates in layout and
          the page below never needs a magic padding-top offset. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            "sticky top-0 z-header flex min-h-14 items-center justify-between gap-3 border-b pt-safe gutter lg:hidden",
            t.surface,
          )}
        >
          {Brand}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            className={cn(
              "-mr-2 flex touch-target shrink-0 items-center justify-center rounded-lg transition-colors",
              t.trigger,
            )}
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        </div>

        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          side="left"
          size="sm"
          title={navLabel}
          hideTitle
          bodyClassName="px-0 py-4"
          footer={
            account || accountActions ? (
              <div className="space-y-3">
                {account}
                {accountActions}
              </div>
            ) : undefined
          }
        >
          <div className="px-5 pb-4">{Brand}</div>
          <NavList
            {...{ nav, currentPath, LinkComponent, tone: "light" as const, label: navLabel }}
            onNavigate={() => setOpen(false)}
          />
        </Sheet>

        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
