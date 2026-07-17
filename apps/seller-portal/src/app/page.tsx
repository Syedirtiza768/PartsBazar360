"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { Badge } from "@repo/ui/badge";
import { ChevronRightIcon, TruckIcon, UploadIcon, BoxIcon, CheckCircleIcon } from "@repo/ui/icons";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
import { PageHeader, StatCard } from "@/components/PageHeader";

interface Stats {
  activeListings: number;
  pendingOrders: number;
  totalRevenue: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const loading = stats === null && !error;

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/analytics/summary?sellerId=${DEMO_SELLER_ID}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  const priorities = [
    {
      icon: <TruckIcon className="h-5 w-5" />,
      title: "Ship ready orders",
      detail: "Work the fulfillment queue and add tracking as soon as labels are created.",
      href: "/orders",
      cta: "Open queue",
    },
    {
      icon: <UploadIcon className="h-5 w-5" />,
      title: "Resolve upload reviews",
      detail: "Approve rows that need fitment or image checks before they go live.",
      href: "/uploads",
      cta: "Review uploads",
    },
    {
      icon: <BoxIcon className="h-5 w-5" />,
      title: "Tune active inventory",
      detail: "Adjust price and stock on listings already live in the marketplace.",
      href: "/inventory",
      cta: "Manage inventory",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Seller workspace"
        title="Store overview"
        description="Track revenue, open orders, listing quality, and upload readiness."
        actions={
          <>
            <Link href="/uploads" className={buttonClasses()}>
              Upload listings
            </Link>
            <Link href="/orders" className={buttonClasses({ variant: "outline" })}>
              View orders
            </Link>
          </>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          Couldn&apos;t load your store metrics. Refresh to try again.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        <StatCard
          label="Total revenue"
          value={stats ? `AED ${stats.totalRevenue?.toLocaleString()}` : "—"}
          helper="Gross marketplace sales"
          loading={loading}
        />
        <StatCard
          label="Pending orders"
          value={stats?.pendingOrders ?? "—"}
          helper="Awaiting seller action"
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Active listings"
          value={stats?.activeListings ?? "—"}
          helper="Live offers in catalog"
          tone="success"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6 xl:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Today&apos;s priorities</h2>
              <p className="mt-1 text-sm text-slate-500">
                Keep fulfillment, compatibility, and stock health moving.
              </p>
            </div>
            <Badge tone="brand">Live marketplace</Badge>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {priorities.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group flex flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition-all duration-150 hover:border-brand-200 hover:bg-brand-50/50 hover:shadow-card"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-500 shadow-card transition-colors group-hover:text-brand-600">
                  {p.icon}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-1 flex-1 text-[13px] leading-relaxed text-slate-500">{p.detail}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                  {p.cta}
                  <ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Listing quality model</h2>
          <p className="mt-1 text-sm text-slate-500">
            What complete, high-converting listings include.
          </p>
          <ul className="mt-5 space-y-3.5">
            {[
              { label: "OE/OEM number", value: "Required" },
              { label: "Compatibility parse", value: "Auto-review" },
              { label: "Part source", value: "OEM or aftermarket" },
              { label: "Quality tier", value: "New, used, refurbished" },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5 last:border-0 last:pb-0">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                  {row.label}
                </span>
                <span className="text-sm font-semibold text-slate-900">{row.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
