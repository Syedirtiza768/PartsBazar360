"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CarIcon,
  HeartIcon,
  ReceiptIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "@repo/ui/icons";
import { buttonClasses } from "@repo/ui/button";
import { useGarage } from "@/lib/garage-context";
import { useWatchlist } from "@/lib/watchlist-context";
import { useAuth } from "@/lib/auth-context";
import { getStoredOrders } from "@/lib/order-history";

export default function AccountOverviewPage() {
  const { vehicles, activeVehicle } = useGarage();
  const { count: watchCount } = useWatchlist();
  const { user, ready, isAuthenticated, logout } = useAuth();
  const [orderCount, setOrderCount] = useState(0);

  useEffect(() => setOrderCount(getStoredOrders().length), []);

  const tiles = [
    { href: "/account/purchases", label: "Purchases", value: orderCount, detail: "Orders saved after checkout on this device", icon: ReceiptIcon },
    { href: "/garage", label: "Garage", value: vehicles.length, detail: activeVehicle ? `Active: ${activeVehicle.makeName} ${activeVehicle.modelName}` : "No active vehicle selected", icon: CarIcon },
    { href: "/watchlist", label: "Watchlist", value: watchCount, detail: "Listings you are comparing", icon: HeartIcon },
  ];

  return (
    <div className="space-y-8">
      <section className="border-2 border-slate-950 bg-white p-5 sm:p-6">
        {ready && isAuthenticated && user ? (
          <>
            <p className="eyebrow">Signed in</p>
            <h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950">
              {user.name || "Buyer"}
            </h2>
            <p className="mt-1 text-sm text-graphite-600">{user.email}</p>
            <button
              type="button"
              onClick={logout}
              className="mt-4 text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">Account</p>
            <h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950">
              Sign in to checkout
            </h2>
            <p className="mt-2 text-sm text-graphite-600">
              Create a buyer account or sign in with your seeded demo login to place orders. Payment
              runs on Stripe Checkout — card details never touch our servers.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/login" className={buttonClasses()}>
                Sign in
              </Link>
              <Link href="/signup" className={buttonClasses({ variant: "outline" })}>
                Create account
              </Link>
            </div>
          </>
        )}
      </section>

      <section>
        <p className="eyebrow">At a glance</p>
        <div className="mt-3 grid border-l border-t border-stone-300 md:grid-cols-3">
          {tiles.map(({ href, label, value, detail, icon: Icon }) => (
            <Link key={href} href={href} className="group min-h-44 border-b border-r border-stone-300 bg-white p-5 hover:bg-brand-950 hover:text-white">
              <div className="flex items-start justify-between"><Icon className="h-6 w-6 text-brand-700 group-hover:text-brand-200" /><span className="font-display text-4xl font-black tabular-nums text-slate-950 group-hover:text-white">{value}</span></div>
              <h2 className="mt-6 font-display text-lg font-black uppercase text-slate-950 group-hover:text-white">{label}</h2>
              <p className="mt-1 text-sm text-graphite-600 group-hover:text-slate-300">{detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="border-2 border-slate-950 bg-white p-5 sm:p-6">
          <p className="eyebrow">Need help with a listing?</p>
          <h2 className="mt-2 font-display text-2xl font-black uppercase text-slate-950">Message before you buy</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">Questions about fitment, photographs, condition, dispatch, or returns stay tied to the part or order you ask about.</p>
          <Link href="/account/messages" className="mt-5 inline-flex items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-700">Open messages <ArrowRightIcon className="h-4 w-4" /></Link>
        </div>
        <div className="border-2 border-slate-950 bg-graphite-950 p-5 text-white sm:p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-200">Buyer protection path</p>
          <h2 className="mt-2 font-display text-2xl font-black uppercase">Seller first. Marketplace support next.</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Start from purchase history to report a delivery, condition, fitment, return, or refund issue with the correct order context attached.</p>
          <Link href="/account/returns" className="mt-5 inline-flex items-center gap-2 text-sm font-black uppercase tracking-wide text-brand-200"><RotateCcwIcon className="h-4 w-4" />Returns & issues</Link>
        </div>
      </section>

      <p className="flex items-start gap-2 border-t border-stone-300 pt-4 text-xs leading-relaxed text-graphite-600"><ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />Garage and watchlist can stay on this device for browsing; checkout requires a signed-in buyer account and Stripe-hosted payment.</p>
    </div>
  );
}
