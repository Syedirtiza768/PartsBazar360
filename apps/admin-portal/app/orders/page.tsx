"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button, buttonClasses } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { DataTable, type Column } from "@repo/ui/data-table";
import { EmptyState } from "@repo/ui/empty-state";
import { Input, Select } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { orderStatusTone } from "@/lib/order-status";

const STATUSES = ["PENDING_PAYMENT", "PAID", "PAYMENT_FAILED", "CANCELLED", "REFUNDED"];

interface OrderRow {
  id: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  buyerId?: string | null;
  sellerOrders?: Array<{ id: string; seller?: { name?: string } }>;
}

export default function OrdersListPage() {
  const { token } = useAdminAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;
  const [status, setStatus] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (targetPage = page) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage), limit: String(limit) });
      if (status) params.set("status", status);
      if (buyerEmail) params.set("buyerEmail", buyerEmail);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await apiFetch(token, `${API_BASE_URL}/operations/orders?${params.toString()}`);
      if (!res.ok) throw new Error("Could not load orders.");
      const data = await res.json();
      setOrders(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total || 0);
      setPage(data.page || targetPage);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    load(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns: Column<OrderRow>[] = [
    {
      key: "order",
      header: "Order",
      priority: "primary",
      cell: (row) => (
        <span className="part-number break-anywhere text-graphite-700">{row.id}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      priority: "secondary",
      cell: (row) => (
        <Badge tone={orderStatusTone(row.status)} size="sm">
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "sellers",
      header: "Sellers",
      cell: (row) => row.sellerOrders?.length || 0,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (row) => (
        <span className="price text-sm">
          {row.currency} {row.totalAmount.toFixed(2)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Placed",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Order management"
        title="Orders"
        description="Every order placed on the marketplace, across all sellers."
      />

      <form
        onSubmit={applyFilters}
        className="grid grid-cols-1 gap-x-4 gap-y-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-2 sm:p-5 lg:grid-cols-5"
      >
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <Input
          label="Buyer email"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          placeholder="buyer@example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex items-end">
          <Button type="submit" fullWidth loading={loading}>
            Apply filters
          </Button>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <DataTable
        caption="Marketplace orders"
        rows={orders}
        columns={columns}
        getRowKey={(row) => row.id}
        tableFrom="md"
        actions={(row) => (
          <Link href={`/orders/${row.id}`} className={buttonClasses({ size: "sm", variant: "secondary" })}>
            View
          </Link>
        )}
        empty={
          <EmptyState
            title={loading ? "Loading orders…" : "No orders match these filters"}
            description={loading ? undefined : "Try widening the date range or clearing a filter."}
          />
        }
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-graphite-600">
          {total} order{total === 1 ? "" : "s"} · page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => load(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </PageBody>
  );
}
