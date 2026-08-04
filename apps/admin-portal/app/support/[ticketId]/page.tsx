"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Input, Select, Textarea } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { ArrowLeftIcon } from "@repo/ui/icons";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

interface TicketMessage {
  id: string;
  authorType: "ADMIN" | "CUSTOMER";
  authorName?: string | null;
  message: string;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  message: string;
  customerName?: string | null;
  customerEmail: string;
  internalNotes?: string | null;
  assignedToUserId?: string | null;
  assignedTo?: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
  messages: TicketMessage[];
  order?: { id: string } | null;
  shippingCountry?: string | null;
  estimatedWeightKg?: number | null;
  cartSummary?: string | null;
  carrier?: string | null;
  quotedRate?: number | null;
  quotedCurrency?: string | null;
}

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const PRIORITIES = ["NORMAL", "HIGH"];

export default function TicketDetailPage() {
  const params = useParams<{ ticketId: string }>();
  const router = useRouter();
  const { token, user } = useAdminAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [quotedRate, setQuotedRate] = useState("");
  const [quotedCurrency, setQuotedCurrency] = useState("USD");
  const [savingQuote, setSavingQuote] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/support/tickets/${params.ticketId}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Ticket not found." : "Could not load ticket.");
      const data = (await res.json()) as TicketDetail;
      setTicket(data);
      setCarrier(data.carrier || "");
      setQuotedRate(data.quotedRate != null ? String(data.quotedRate) : "");
      setQuotedCurrency(data.quotedCurrency || "USD");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load ticket.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, params.ticketId]);

  const patch = async (body: Record<string, unknown>) => {
    if (!ticket) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/support/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not update ticket.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update ticket.");
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!ticket || !reply.trim()) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch(token, `${API_BASE_URL}/support/tickets/${ticket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim(), replyBy: user?.name || user?.email }),
      });
      if (!res.ok) throw new Error("Could not send reply.");
      setReply("");
      setMessage("Reply sent to the customer.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reply.");
    } finally {
      setSending(false);
    }
  };

  const saveQuote = async (event: FormEvent) => {
    event.preventDefault();
    if (!ticket) return;
    setSavingQuote(true);
    setError(null);
    setMessage(null);
    try {
      const rate = quotedRate.trim() ? Number(quotedRate) : null;
      if (quotedRate.trim() && Number.isNaN(rate)) {
        throw new Error("Enter a valid quoted rate.");
      }
      const res = await apiFetch(token, `${API_BASE_URL}/support/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: carrier.trim() || null,
          quotedRate: rate,
          quotedCurrency: quotedCurrency.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Could not save the freight quote.");
      setMessage("Freight quote saved.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the freight quote.");
    } finally {
      setSavingQuote(false);
    }
  };

  if (loading) {
    return (
      <PageBody className="space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageBody>
    );
  }

  if (!ticket) {
    return (
      <PageBody className="space-y-4">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Ticket not found."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/support")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to tickets
        </button>
      </PageBody>
    );
  }

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <button
        type="button"
        onClick={() => router.push("/support")}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Back to tickets
      </button>

      <PageHeader
        eyebrow={ticket.category.replace(/_/g, " ")}
        title={ticket.subject}
        description={`From ${ticket.customerName || ticket.customerEmail} · ${new Date(ticket.createdAt).toLocaleString()}`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Status"
              value={ticket.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={saving}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <Select
              label="Priority"
              value={ticket.priority}
              onChange={(e) => patch({ priority: e.target.value })}
              disabled={saving}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            {ticket.assignedToUserId === user?.id ? (
              <Button variant="outline" size="sm" disabled={saving} onClick={() => patch({ assignedToUserId: null })}>
                Unassign me
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={saving} onClick={() => patch({ assignedToUserId: user?.id })}>
                Assign to me
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-graphite-600">
        <Badge tone={ticket.assignedTo ? "brand" : "outline"} size="sm">
          {ticket.assignedTo ? `Assigned to ${ticket.assignedTo.name || ticket.assignedTo.email}` : "Unassigned"}
        </Badge>
        {ticket.order && <span>Order {ticket.order.id}</span>}
        <a href={`mailto:${ticket.customerEmail}`} className="text-blue-700 hover:underline">
          {ticket.customerEmail}
        </a>
      </div>

      {ticket.category === "FREIGHT_QUOTE" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-card sm:p-5" aria-label="Freight quote">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-900">Freight quote</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-graphite-600">Shipping to</dt>
              <dd className="text-slate-900">{ticket.shippingCountry || "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-graphite-600">Estimated weight</dt>
              <dd className="text-slate-900">
                {ticket.estimatedWeightKg != null ? `${ticket.estimatedWeightKg}kg` : "Not provided"}
              </dd>
            </div>
            <div className="sm:col-span-1">
              <dt className="text-xs font-semibold text-graphite-600">Cart</dt>
              <dd className="text-slate-900">{ticket.cartSummary || "Not provided"}</dd>
            </div>
          </dl>

          <form onSubmit={saveQuote} className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-amber-200 pt-4 sm:grid-cols-4">
            <Input label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. Aramex" />
            <Input
              label="Quoted rate"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={quotedRate}
              onChange={(e) => setQuotedRate(e.target.value)}
            />
            <Input label="Currency" value={quotedCurrency} onChange={(e) => setQuotedCurrency(e.target.value)} />
            <div className="flex items-end">
              <Button type="submit" fullWidth loading={savingQuote}>
                Save quote
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-4" aria-label="Conversation">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">
              {ticket.customerName || ticket.customerEmail}
            </p>
            <p className="text-xs text-graphite-600">{new Date(ticket.createdAt).toLocaleString()}</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-graphite-700">{ticket.message}</p>
        </article>

        {ticket.messages.map((m) => (
          <article
            key={m.id}
            className={`rounded-xl border p-4 shadow-card sm:p-5 ${
              m.authorType === "ADMIN" ? "border-blue-100 bg-blue-50/60" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">
                {m.authorName || (m.authorType === "ADMIN" ? "Operations" : ticket.customerName || "Customer")}
              </p>
              <p className="text-xs text-graphite-600">{new Date(m.createdAt).toLocaleString()}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-graphite-700">{m.message}</p>
          </article>
        ))}
      </section>

      <form onSubmit={sendReply} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <Textarea
          label="Reply to customer"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          placeholder="Type a reply — this is emailed to the customer immediately."
          required
        />
        <div className="flex justify-end">
          <Button type="submit" loading={sending} disabled={!reply.trim()} fullWidth className="sm:w-auto">
            Send reply
          </Button>
        </div>
      </form>
    </PageBody>
  );
}
