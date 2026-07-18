'use client';

import { useEffect, useState } from 'react';
import { REVIEW_QUEUE_TYPES, partTypeLabel } from '@repo/catalog-contracts';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface QueueCount {
  queueType: string;
  count: number;
}

interface ReviewTask {
  id: string;
  queueType: string;
  status: string;
  severity: string;
  title: string;
  description?: string | null;
  confidence?: number | null;
  seller?: { name: string } | null;
  canonicalPart?: {
    id: string;
    title: string;
    partType?: string | null;
    brand?: string | null;
    manufacturerPartNumber?: string | null;
  } | null;
  createdAt: string;
}

export default function CatalogGovernancePage() {
  const [queues, setQueues] = useState<QueueCount[]>([]);
  const [openTotal, setOpenTotal] = useState(0);
  const [activeQueue, setActiveQueue] = useState<string>(REVIEW_QUEUE_TYPES[0]);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async (queueType = activeQueue) => {
    setLoading(true);
    setError(null);
    try {
      const [queueRes, reviewRes] = await Promise.all([
        fetch(`${API_BASE_URL}/admin/catalog/queues`),
        fetch(`${API_BASE_URL}/admin/catalog/reviews?queueType=${encodeURIComponent(queueType)}&status=OPEN`),
      ]);
      if (!queueRes.ok || !reviewRes.ok) throw new Error('Failed to load catalog queues');
      const queueData = await queueRes.json();
      const reviewData = await reviewRes.json();
      setQueues(queueData.queues || []);
      setOpenTotal(queueData.openTotal || 0);
      setTasks(Array.isArray(reviewData) ? reviewData : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(activeQueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue]);

  const resolve = async (taskId: string, status: string) => {
    setResolving(taskId);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/catalog/reviews/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution: status === 'RESOLVED' ? 'Reviewed in admin console' : 'Dismissed', resolvedBy: 'admin' }),
      });
      if (!res.ok) throw new Error('Could not update review task');
      await load(activeQueue);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Catalog governance</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Review queues</h1>
          <p className="mt-1 text-slate-600">
            Classification, OEM parsing, authenticity, and match conflicts from seller imports and seed runs.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open tasks</p>
          <p className="text-2xl font-bold text-slate-950">{openTotal}</p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Queues</h2>
          <ul className="mt-3 space-y-1">
            {REVIEW_QUEUE_TYPES.map((queueType) => {
              const count = queues.find((q) => q.queueType === queueType)?.count || 0;
              return (
                <li key={queueType}>
                  <button
                    type="button"
                    onClick={() => setActiveQueue(queueType)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      activeQueue === queueType ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{queueType.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-xs">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-900">{activeQueue.replace(/_/g, ' ')}</h2>
          </div>
          {loading ? (
            <p className="px-5 py-10 text-sm text-slate-500">Loading review tasks…</p>
          ) : tasks.length === 0 ? (
            <p className="px-5 py-10 text-sm text-slate-500">No open tasks in this queue.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <li key={task.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {task.severity}
                        </span>
                        {typeof task.confidence === 'number' && (
                          <span className="text-xs tabular-nums text-slate-500">
                            Confidence {(task.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold text-slate-950">{task.title}</h3>
                      {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
                      <p className="mt-2 text-xs text-slate-500">
                        {task.seller?.name || 'Unknown seller'}
                        {task.canonicalPart
                          ? ` · ${task.canonicalPart.brand || 'No brand'} · ${task.canonicalPart.manufacturerPartNumber || task.canonicalPart.title} · ${partTypeLabel(task.canonicalPart.partType)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={resolving === task.id}
                        onClick={() => resolve(task.id, 'RESOLVED')}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        disabled={resolving === task.id}
                        onClick={() => resolve(task.id, 'DISMISSED')}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
