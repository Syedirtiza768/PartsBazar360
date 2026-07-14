"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';

export default function DashboardPage() {
  const [stats, setStats] = useState({ activeListings: 0, pendingOrders: 0, totalRevenue: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/analytics/summary?sellerId=${DEMO_SELLER_ID}`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Seller Workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Store overview</h1>
          <p className="text-slate-600 mt-1">Track revenue, open orders, listing quality, and upload readiness.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/uploads" className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors">
            Upload listings
          </Link>
          <Link href="/orders" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            View orders
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard label="Total revenue" value={`AED ${loading ? '...' : stats.totalRevenue?.toLocaleString()}`} helper="Gross marketplace sales" />
        <MetricCard label="Pending orders" value={loading ? '...' : stats.pendingOrders} helper="Awaiting seller action" tone="text-amber-700" />
        <MetricCard label="Active listings" value={loading ? '...' : stats.activeListings} helper="Live offers in catalog" tone="text-emerald-700" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Today&apos;s seller priorities</h2>
              <p className="mt-1 text-sm text-slate-500">Keep fulfillment, compatibility, and stock health moving.</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-100">
              Live marketplace
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <PriorityCard title="Ship ready orders" detail="Review the fulfillment queue and add tracking as soon as labels are created." href="/orders" />
            <PriorityCard title="Resolve upload reviews" detail="Approve rows that need fitment or image checks before they become active offers." href="/uploads" />
            <PriorityCard title="Tune active inventory" detail="Adjust price and stock on listings that are already live in the marketplace." href="/inventory" />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Listing quality model</h2>
          <div className="mt-5 space-y-4">
            <QualityRow label="OE/OEM number" value="Required" />
            <QualityRow label="Compatibility parse" value="Auto-review" />
            <QualityRow label="Part source" value="OEM or aftermarket" />
            <QualityRow label="Quality tier" value="New, used, refurbished" />
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, helper, tone = 'text-slate-950' }: { label: string; value: number | string; helper: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-medium text-slate-500">{label}</h3>
      <div className={`mt-2 text-4xl font-bold ${tone}`}>{value}</div>
      <p className="mt-2 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function PriorityCard({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 bg-slate-50 p-4 hover:border-emerald-200 hover:bg-emerald-50 transition-colors">
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </Link>
  );
}

function QualityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}
