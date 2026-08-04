"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@repo/ui/button";
import { Badge } from "@repo/ui/badge";
import { PageBody } from "@repo/ui/container";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

const PORTALS = [
  {
    name: "Buyer Marketplace",
    href: "/buyer/",
    description: "Fitment-first shopping experience for end customers.",
    accent: "text-blue-700 bg-blue-50 border-blue-100",
  },
  {
    name: "Seller Portal",
    href: "/seller/",
    description: "Inventory pricing, stock, uploads, and order fulfillment for merchants.",
    accent: "text-emerald-700 bg-emerald-50 border-emerald-100",
  },
  {
    name: "Operations Portal",
    href: "/operations/",
    description: "Checkout monitoring, seller upload exceptions, support, and fulfillment.",
    accent: "text-amber-700 bg-amber-50 border-amber-100",
  },
  {
    name: "Workshop Portal",
    href: "/workshop/",
    description: "Tools for repair workshops and installers.",
    accent: "text-violet-700 bg-violet-50 border-violet-100",
  },
];

interface DashboardData {
  metrics?: {
    openTickets: number;
    uploadJobs: number;
    pendingSellerOrders: number;
    recentOrderCount: number;
  };
  recentOrders?: Array<{
    id: string;
    totalAmount: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
  recentTickets?: Array<{
    id: string;
    subject: string;
    category: string;
    priority: string;
    status: string;
    customerEmail: string;
  }>;
}

export default function Home() {
  const { token } = useAdminAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await apiFetch(token, `${API_BASE_URL}/operations/dashboard`);
        if (res.ok) setDashboard(await res.json());
      } catch {
        /* silent fail */
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const metrics = dashboard?.metrics || {
    openTickets: 0,
    uploadJobs: 0,
    pendingSellerOrders: 0,
    recentOrderCount: 0,
  };

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Platform admin"
        title="Marketplace control center"
        description="Govern portals, catalogue quality, seller readiness, and operational health."
        actions={
          <Link href="/catalog" className={buttonClasses()}>
            Open catalog queues
          </Link>
        }
      />

      {/* Live metrics */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "Open support tickets", value: metrics.openTickets, tone: "text-amber-700" },
          { label: "Uploads needing ops", value: metrics.uploadJobs, tone: "text-blue-700" },
          { label: "Seller orders pending", value: metrics.pendingSellerOrders, tone: "text-emerald-700" },
          { label: "Recent orders", value: metrics.recentOrderCount, tone: "text-slate-900" },
        ].map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <dt className="text-sm font-medium text-graphite-600">{item.label}</dt>
            <dd className={`mt-1.5 text-balance text-base font-bold sm:text-xl ${item.tone}`}>
              {loading ? "\u2014" : item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Portal access */}
        <section
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6 xl:col-span-2"
          aria-labelledby="portals-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="portals-heading" className="text-lg font-semibold text-slate-900">Portal access</h2>
              <p className="mt-1 text-sm text-graphite-600">
                Jump into the customer, seller, operations, or workshop experience.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-graphite-600">
              4 portals
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            {PORTALS.map((portal) => (
              <a
                key={portal.href}
                href={portal.href}
                className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-blue-200 hover:bg-white sm:p-5"
              >
                <span className={`inline-flex self-start rounded-full border px-2.5 py-1 text-xs font-semibold ${portal.accent}`}>
                  {portal.name}
                </span>
                <p className="mt-3 flex-1 text-pretty text-sm text-graphite-600">{portal.description}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Recent tickets */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Recent tickets</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {(dashboard?.recentTickets || []).slice(0, 5).map((ticket) => (
              <li key={ticket.id} className="px-4 py-3">
                <p className="font-medium text-slate-900 text-sm">{ticket.subject}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge size="sm" tone={ticket.priority === "HIGH" ? "danger" : "outline"}>
                    {ticket.priority}
                  </Badge>
                  <span className="text-xs text-graphite-600">{ticket.category}</span>
                </div>
              </li>
            ))}
            {(dashboard?.recentTickets || []).length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-graphite-600">
                {loading ? "Loading\u2026" : "No tickets yet"}
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* Recent orders */}
      {(dashboard?.recentOrders || []).length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-600">Recent orders</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {(dashboard?.recentOrders || []).slice(0, 8).map((order) => (
              <li key={order.id} className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="part-number break-anywhere text-sm font-semibold text-slate-900">{order.id}</p>
                  <p className="text-xs text-graphite-600">
                    {new Date(order.createdAt).toLocaleDateString()} &middot; {order.status.replace(/_/g, " ")}
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {order.currency} {order.totalAmount.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Admin checklist */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Admin checklist</h2>
        <div className="mt-4 space-y-4">
          <ChecklistItem title="Catalogue governance" detail="Open Catalog queues to clear classification, OEM parse, and authenticity reviews." />
          <ChecklistItem title="Seller readiness" detail="Use upload review counts to identify sellers needing support." />
          <ChecklistItem title="Customer support" detail="Watch fitment and order tickets for escalation patterns." />
          <ChecklistItem title="Fulfillment health" detail="Keep pending seller orders visible to operations." />
        </div>
      </section>
    </PageBody>
  );
}

function ChecklistItem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-pretty text-sm text-graphite-600">{detail}</p>
    </div>
  );
}
