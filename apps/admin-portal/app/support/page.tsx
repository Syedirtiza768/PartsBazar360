"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button, buttonClasses } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { DataTable, type Column } from "@repo/ui/data-table";
import { EmptyState } from "@repo/ui/empty-state";
import { Select } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const CATEGORIES = ["GENERAL", "FITMENT", "ORDER_ISSUE", "FREIGHT_QUOTE"];

interface TicketRow {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  customerEmail: string;
  customerName?: string | null;
  assignedToUserId?: string | null;
  createdAt: string;
}

export default function SupportListPage() {
  const { token } = useAdminAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      const res = await apiFetch(token, `${API_BASE_URL}/support/tickets?${params.toString()}`);
      if (!res.ok) throw new Error("Could not load support tickets.");
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load support tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    load();
  };

  const columns: Column<TicketRow>[] = [
    {
      key: "subject",
      header: "Ticket",
      priority: "primary",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{row.subject}</p>
          <p className="mt-0.5 break-anywhere text-xs text-graphite-600">
            {row.customerName || row.customerEmail}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      priority: "secondary",
      cell: (row) => <span className="text-xs text-graphite-600">{row.category.replace(/_/g, " ")}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      cell: (row) => (
        <Badge tone={row.priority === "HIGH" ? "danger" : "outline"} size="sm">
          {row.priority}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge tone={row.status === "OPEN" ? "warning" : row.status === "RESOLVED" ? "success" : "info"} size="sm">
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "assignee",
      header: "Assigned",
      cell: (row) => (
        <span className="text-xs text-graphite-600">{row.assignedToUserId ? "Assigned" : "Unassigned"}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Received",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Customer support"
        title="Support tickets"
        description="Fitment questions, order issues, and freight quote requests from buyers."
      />

      <form
        onSubmit={applyFilters}
        className="grid grid-cols-1 gap-x-4 gap-y-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-3 sm:p-5"
      >
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <div className="flex items-end">
          <Button type="submit" fullWidth loading={loading}>
            Apply filters
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <DataTable
        caption="Support tickets"
        rows={tickets}
        columns={columns}
        getRowKey={(row) => row.id}
        tableFrom="md"
        actions={(row) => (
          <Link href={`/support/${row.id}`} className={buttonClasses({ size: "sm", variant: "secondary" })}>
            Open
          </Link>
        )}
        empty={
          <EmptyState
            title={loading ? "Loading tickets…" : "No tickets match these filters"}
            description={loading ? undefined : "Try clearing a filter."}
          />
        }
      />
    </PageBody>
  );
}
