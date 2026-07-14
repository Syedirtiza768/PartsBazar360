"use client";

import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';

interface SyncResult {
  message: string;
  jobId: string;
  storeId: string;
}

interface DashboardData {
  metrics?: {
    openTickets: number;
    uploadJobs: number;
    pendingSellerOrders: number;
    recentOrderCount: number;
  };
  recentUploads?: any[];
  recentTickets?: any[];
}

export default function OperationsCommandCenterPage() {
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SyncResult[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fulfillmentQueue = useMemo(() => (
    orders.flatMap((order) => (order.sellerOrders || []).map((sellerOrder: any) => ({
      ...sellerOrder,
      parentOrderId: order.id,
      customerEmail: order.customerEmail,
      totalAmount: order.totalAmount,
      currency: order.currency,
    }))).filter((sellerOrder) => ['PROCESSING', 'READY_TO_SHIP'].includes(sellerOrder.status))
  ), [orders]);

  const loadOperations = async () => {
    setLoading(true);
    try {
      const [dashboardRes, ordersRes, ticketsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/operations/dashboard`),
        fetch(`${API_BASE_URL}/operations/orders`),
        fetch(`${API_BASE_URL}/support/tickets`),
      ]);
      setDashboard(await dashboardRes.json());
      const ordersData = await ordersRes.json();
      const ticketsData = await ticketsRes.json();
      setOrders(Array.isArray(ordersData) ? ordersData : []);
      setTickets(Array.isArray(ticketsData) ? ticketsData : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load operations data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOperations();
  }, []);

  const handleTriggerSync = async () => {
    if (!storeId.trim()) {
      setError('Store ID is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/operations/sync/realtrack/${encodeURIComponent(storeId.trim())}`, {
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
    } catch (err: any) {
      setError(err?.message || 'Failed to queue sync job.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateSellerOrder = async (sellerOrderId: string) => {
    const trackingNumber = window.prompt('Tracking number');
    if (!trackingNumber) return;
    const carrier = window.prompt('Carrier') || undefined;

    await fetch(`${API_BASE_URL}/operations/seller-orders/${sellerOrderId}/fulfillment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SHIPPED', trackingNumber, carrier }),
    });
    await loadOperations();
  };

  const updateTicket = async (ticketId: string, status: string) => {
    await fetch(`${API_BASE_URL}/support/tickets/${ticketId}`, {
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Operations Command Center</h1>
        <p className="text-zinc-400">
          Monitor checkout flow, seller upload exceptions, customer support, and fulfilment readiness from one place.
        </p>
      </header>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="Open support tickets" value={loading ? '...' : metrics.openTickets} tone="text-amber-300" />
        <MetricCard label="Uploads needing ops" value={loading ? '...' : metrics.uploadJobs} tone="text-blue-300" />
        <MetricCard label="Seller orders pending" value={loading ? '...' : metrics.pendingSellerOrders} tone="text-emerald-300" />
        <MetricCard label="Recent orders" value={loading ? '...' : metrics.recentOrderCount} tone="text-white" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Fulfilment Queue</h2>
            <button onClick={loadOperations} className="text-xs font-medium text-zinc-300 hover:text-white">Refresh</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400">
                <tr>
                  <th className="px-6 py-4 font-medium">Order</th>
                  <th className="px-6 py-4 font-medium">Seller</th>
                  <th className="px-6 py-4 font-medium">Items</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {fulfillmentQueue.map((sellerOrder) => (
                  <tr key={sellerOrder.id} className="hover:bg-zinc-800/40">
                    <td className="px-6 py-4">
                      <p className="font-mono text-xs text-zinc-300">{sellerOrder.parentOrderId}</p>
                      <p className="text-xs text-zinc-500">{sellerOrder.customerEmail || 'Customer email missing'}</p>
                    </td>
                    <td className="px-6 py-4 text-white">{sellerOrder.seller?.name || 'Seller'}</td>
                    <td className="px-6 py-4 text-zinc-300">{sellerOrder.items?.length || 0}</td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300">{sellerOrder.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => updateSellerOrder(sellerOrder.id)} className="text-sm font-medium text-emerald-400 hover:text-emerald-300">
                        Mark shipped
                      </button>
                    </td>
                  </tr>
                ))}
                {fulfillmentQueue.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-zinc-500">No seller orders waiting on fulfilment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">RealTrack Catalogue Sync</h2>
            <p className="mt-1 text-xs text-zinc-500">Queue an ingestion job for a source store without leaving operations.</p>
          </div>
          <input value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="Store ID" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-amber-500" />
          <input type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-amber-500" />
          <button onClick={handleTriggerSync} disabled={submitting} className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg disabled:opacity-50">
            {submitting ? 'Queuing job...' : 'Trigger sync'}
          </button>
          {result && <p className="text-sm text-emerald-400">Queued job <span className="font-mono">{result.jobId}</span>.</p>}
          {history.length > 0 && (
            <ul className="space-y-2 pt-2">
              {history.slice(0, 3).map((item, idx) => (
                <li key={`${item.jobId}-${idx}`} className="text-xs text-zinc-500">Store {item.storeId}: <span className="font-mono">{item.jobId}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Support Tickets</h2>
          </div>
          <ul className="divide-y divide-zinc-800">
            {tickets.slice(0, 8).map((ticket) => (
              <li key={ticket.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-white">{ticket.subject}</p>
                  <p className="mt-1 text-xs text-zinc-500">{ticket.category} / {ticket.priority} / {ticket.customerEmail}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => updateTicket(ticket.id, 'IN_PROGRESS')} className="text-xs font-medium text-blue-300 hover:text-blue-200">Start</button>
                  <button onClick={() => updateTicket(ticket.id, 'RESOLVED')} className="text-xs font-medium text-emerald-300 hover:text-emerald-200">Resolve</button>
                </div>
              </li>
            ))}
            {tickets.length === 0 && <li className="px-6 py-8 text-center text-zinc-500 text-sm">No support tickets yet.</li>}
          </ul>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Seller Upload Exceptions</h2>
          </div>
          <ul className="divide-y divide-zinc-800">
            {(dashboard?.recentUploads || []).map((job: any) => (
              <li key={job.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white truncate">{job.fileName}</p>
                  <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{job.status}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {job.seller?.name || 'Seller'}: {job.insertedRows} imported, {job.reviewRows} review, {job.invalidRows} invalid
                </p>
              </li>
            ))}
            {(dashboard?.recentUploads || []).length === 0 && <li className="px-6 py-8 text-center text-zinc-500 text-sm">No upload jobs yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
      <h3 className="text-sm font-medium text-zinc-400">{label}</h3>
      <div className={`text-4xl font-bold mt-2 ${tone}`}>{value}</div>
    </div>
  );
}
