"use client";

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@repo/ui/button';
import { Badge } from '@repo/ui/badge';
import { PageBody } from '@repo/ui/container';
import { DataTable, type Column } from '@repo/ui/data-table';
import { EmptyState } from '@repo/ui/empty-state';
import { Input } from '@repo/ui/field';
import { PageHeader, StatCard, StatGrid } from '@repo/ui/page-header';
import { Sheet } from '@repo/ui/sheet';
import { AlertCircleIcon } from '@repo/ui/icons';
import { useAdminAuth } from '@/lib/auth-context';
import { API_BASE_URL, apiFetch } from '@/lib/api';

interface SyncResult {
  message: string;
  jobId: string;
  storeId: string;
}

/** Loosely-shaped operational records from the ops endpoints. */
type Record_ = Record<string, unknown>;

interface UploadJobRow extends Record_ {
  id: string;
  fileName?: string;
  status?: string;
  insertedRows?: number;
  reviewRows?: number;
  invalidRows?: number;
  seller?: { name?: string };
}

interface TicketRow extends Record_ {
  id: string;
  subject?: string;
  category?: string;
  priority?: string;
  customerEmail?: string;
}

interface OrderRow extends Record_ {
  id: string;
  customerEmail?: string;
  totalAmount?: number;
  currency?: string;
  sellerOrders?: QueueRow[];
}

interface DashboardData {
  metrics?: {
    openTickets: number;
    uploadJobs: number;
    pendingSellerOrders: number;
    recentOrderCount: number;
  };
  recentUploads?: UploadJobRow[];
  recentTickets?: TicketRow[];
}

interface QueueRow {
  id: string;
  parentOrderId: string;
  customerEmail?: string;
  status: string;
  seller?: { name?: string };
  items?: unknown[];
  [key: string]: unknown;
}

export default function OperationsCommandCenterPage() {
  const { token } = useAdminAuth();
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SyncResult[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Replaces two chained window.prompt() calls: prompt is suppressed outright
  // in several mobile in-app browsers, which made "mark shipped" a dead button
  // on exactly the devices operators use on the warehouse floor.
  const [shipping, setShipping] = useState<QueueRow | null>(null);

  const fulfillmentQueue = useMemo<QueueRow[]>(() => (
    orders.flatMap((order) => (order.sellerOrders || []).map((sellerOrder: QueueRow) => ({
      ...sellerOrder,
      parentOrderId: order.id,
      customerEmail: order.customerEmail,
      totalAmount: order.totalAmount,
      currency: order.currency,
    }))).filter((sellerOrder: QueueRow) => sellerOrder.status === 'PROCESSING')
  ), [orders]);

  const loadOperations = async () => {
    setLoading(true);
    try {
      const [dashboardRes, ordersRes, ticketsRes] = await Promise.all([
        apiFetch(token, `${API_BASE_URL}/operations/dashboard`),
        apiFetch(token, `${API_BASE_URL}/operations/orders`),
        apiFetch(token, `${API_BASE_URL}/support/tickets`),
      ]);
      setDashboard(await dashboardRes.json());
      const ordersData = await ordersRes.json();
      const ticketsData = await ticketsRes.json();
      setOrders(
        Array.isArray(ordersData)
          ? ordersData
          : Array.isArray(ordersData.items)
            ? ordersData.items
            : [],
      );
      setTickets(Array.isArray(ticketsData) ? ticketsData : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load operations data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleTriggerSync = async (event: FormEvent) => {
    event.preventDefault();
    if (!storeId.trim()) {
      setError('Store ID is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await apiFetch(token, `${API_BASE_URL}/operations/sync/realtrack/${encodeURIComponent(storeId.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: Number(page) || 1 }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Request failed with status ${res.status}`);
      }

      const data: SyncResult = await res.json();
      setResult(data);
      setHistory((prev) => [data, ...prev].slice(0, 10));
      await loadOperations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to queue sync job.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateSellerOrder = async (
    sellerOrderId: string,
    trackingNumber: string,
    carrier?: string,
  ) => {
    const res = await apiFetch(token, `${API_BASE_URL}/operations/seller-orders/${sellerOrderId}/fulfillment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SHIPPED', trackingNumber, carrier }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || 'Could not update delivery status.');
    }
    await loadOperations();
  };

  const updateTicket = async (ticketId: string, status: string) => {
    await apiFetch(token, `${API_BASE_URL}/support/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadOperations();
  };

  const metrics = dashboard?.metrics || {
    openTickets: 0,
    uploadJobs: 0,
    pendingSellerOrders: 0,
    recentOrderCount: 0,
  };

  const queueColumns: Column<QueueRow>[] = [
    {
      key: 'order',
      header: 'Order',
      priority: 'primary',
      cell: (row) => (
        <div className="min-w-0">
          <p className="part-number break-anywhere text-graphite-700">{row.parentOrderId}</p>
          <p className="mt-0.5 break-anywhere text-xs text-graphite-600">
            {row.customerEmail || 'Customer email missing'}
          </p>
        </div>
      ),
    },
    {
      key: 'seller',
      header: 'Seller',
      cell: (row) => <span className="font-medium text-slate-900">{row.seller?.name || 'Seller'}</span>,
    },
    { key: 'items', header: 'Items', align: 'right', cell: (row) => row.items?.length || 0 },
    {
      key: 'status',
      header: 'Status',
      priority: 'secondary',
      cell: (row) => <Badge tone="warning" size="sm">{row.status}</Badge>,
    },
  ];

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Operator workspace"
        title="Operations command center"
        description="Monitor checkout flow, seller upload exceptions, customer support, and fulfilment readiness from one place."
        actions={
          <Button variant="outline" onClick={loadOperations} loading={loading}>
            Refresh operations
          </Button>
        }
      />

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-anywhere">{error}</span>
        </p>
      )}

      <StatGrid>
        <StatCard label="Open support tickets" value={loading ? '—' : metrics.openTickets} tone="warning" loading={loading} />
        <StatCard label="Uploads needing ops" value={loading ? '—' : metrics.uploadJobs} loading={loading} />
        <StatCard label="Seller orders pending" value={loading ? '—' : metrics.pendingSellerOrders} tone="success" loading={loading} />
        <StatCard label="Recent orders" value={loading ? '—' : metrics.recentOrderCount} loading={loading} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="min-w-0 xl:col-span-2" aria-labelledby="queue-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="queue-heading" className="text-sm font-semibold uppercase tracking-wider text-graphite-600">
              Fulfilment queue
            </h2>
            <span className="text-xs font-semibold text-graphite-600">
              {fulfillmentQueue.length} pending
            </span>
          </div>
          <DataTable
            caption="Seller orders awaiting fulfilment"
            rows={fulfillmentQueue}
            columns={queueColumns}
            getRowKey={(row) => row.id}
            tableFrom="lg"
            actions={(row) => (
              <Button size="sm" variant="secondary" onClick={() => setShipping(row)}>
                Mark shipped
              </Button>
            )}
            empty={
              <EmptyState
                title="Nothing waiting on fulfilment"
                description="Seller orders awaiting shipment will appear here."
              />
            }
          />
        </section>

        <section
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-card"
          aria-labelledby="sync-heading"
        >
          <h2 id="sync-heading" className="text-sm font-semibold uppercase tracking-wider text-graphite-600">
            RealTrack catalogue sync
          </h2>
          <p className="mt-1 text-xs text-graphite-600">
            Queue an ingestion job for a source store without leaving operations.
          </p>
          <form onSubmit={handleTriggerSync} className="mt-4 space-y-3.5">
            <Input
              label="Store ID"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="e.g. rt-4821"
              autoComplete="off"
              // Store IDs are alphanumeric; the plain keyboard is correct, but
              // autocapitalise/autocorrect would mangle them on iOS.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <Input
              label="Start page"
              type="number"
              min={1}
              inputMode="numeric"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              hint="Ingestion resumes from this page of the source feed."
            />
            <Button type="submit" fullWidth loading={submitting}>
              {submitting ? 'Queuing job…' : 'Trigger sync'}
            </Button>
          </form>
          {result && (
            <p className="mt-3 text-sm text-emerald-700" role="status">
              Queued job <span className="part-number break-anywhere">{result.jobId}</span>.
            </p>
          )}
          {history.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
              {history.slice(0, 3).map((item, idx) => (
                <li key={`${item.jobId}-${idx}`} className="break-anywhere text-xs text-graphite-600">
                  Store {item.storeId}: <span className="part-number">{item.jobId}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section
          className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
          aria-labelledby="tickets-heading"
        >
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <h2 id="tickets-heading" className="text-sm font-semibold uppercase tracking-wider text-graphite-600">
              Support tickets
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {tickets.slice(0, 8).map((ticket) => (
              <li key={ticket.id} className="px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5">
                {/* Stacks on phones: side-by-side text + actions squeezed the
                    subject to two characters per line at 320px. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{ticket.subject}</p>
                    <p className="mt-1 break-anywhere text-xs text-graphite-600">
                      {ticket.category} / {ticket.priority} / {ticket.customerEmail}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateTicket(ticket.id, 'IN_PROGRESS')}>
                      Start
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => updateTicket(ticket.id, 'RESOLVED')}>
                      Resolve
                    </Button>
                  </div>
                </div>
              </li>
            ))}
            {tickets.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-graphite-600 sm:px-5">
                No support tickets yet.
              </li>
            )}
          </ul>
        </section>

        <section
          className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
          aria-labelledby="uploads-heading"
        >
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <h2 id="uploads-heading" className="text-sm font-semibold uppercase tracking-wider text-graphite-600">
              Seller upload exceptions
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {(dashboard?.recentUploads || []).map((job) => (
              <li key={job.id} className="px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  {/* break-anywhere, not truncate: an operator needs the whole
                      filename to find the upload, and it is often 60+ chars. */}
                  <p className="min-w-0 break-anywhere font-semibold text-slate-900">{job.fileName}</p>
                  <Badge size="sm" className="shrink-0">{job.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-graphite-600">
                  {job.seller?.name || 'Seller'}: {job.insertedRows} imported, {job.reviewRows} review,{' '}
                  {job.invalidRows} invalid
                </p>
              </li>
            ))}
            {(dashboard?.recentUploads || []).length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-graphite-600 sm:px-5">No upload jobs yet.</li>
            )}
          </ul>
        </section>
      </div>

      <ShipmentSheet
        row={shipping}
        onClose={() => setShipping(null)}
        onSubmit={updateSellerOrder}
      />
    </PageBody>
  );
}

/**
 * Bottom sheet on phones, centred dialog from `sm` up. Both fields are in one
 * form so the operator fills them in a single pass, rather than answering two
 * blocking prompts back to back.
 */
function ShipmentSheet({
  row,
  onClose,
  onSubmit,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onSubmit: (id: string, trackingNumber: string, carrier?: string) => Promise<void>;
}) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset between orders so a previous tracking number can't be submitted
  // against the next one.
  useEffect(() => {
    setTrackingNumber('');
    setCarrier('');
  }, [row?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!row || !trackingNumber.trim()) return;
    setSaving(true);
    try {
      await onSubmit(row.id, trackingNumber.trim(), carrier.trim() || undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={Boolean(row)}
      onClose={onClose}
      title="Mark shipped"
      description={row ? `Order ${row.parentOrderId}` : undefined}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} fullWidth className="sm:w-auto">
            Cancel
          </Button>
          <Button
            form="shipment-form"
            type="submit"
            loading={saving}
            disabled={!trackingNumber.trim()}
            fullWidth
            className="sm:w-auto"
          >
            Mark shipped
          </Button>
        </div>
      }
    >
      <form id="shipment-form" onSubmit={submit} className="space-y-4">
        <Input
          label="Tracking number"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <Input
          label="Carrier"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          hint="Optional."
        />
      </form>
    </Sheet>
  );
}
