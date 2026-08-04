'use client';

import { useEffect, useState } from 'react';
import { REVIEW_QUEUE_TYPES, partTypeLabel } from '@repo/catalog-contracts';
import { Badge } from '@repo/ui/badge';
import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/cn';
import { PageBody } from '@repo/ui/container';
import { EmptyState } from '@repo/ui/empty-state';
import { PageHeader } from '@repo/ui/page-header';
import { SkeletonText } from '@repo/ui/skeleton';
import { CheckCircleIcon } from '@repo/ui/icons';
import { useAdminAuth } from '@/lib/auth-context';
import { API_BASE_URL, apiFetch } from '@/lib/api';

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
  const { token } = useAdminAuth();
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
        apiFetch(token, `${API_BASE_URL}/admin/catalog/queues`),
        apiFetch(token, `${API_BASE_URL}/admin/catalog/reviews?queueType=${encodeURIComponent(queueType)}&status=OPEN`),
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
      const res = await apiFetch(token, `${API_BASE_URL}/admin/catalog/reviews/${taskId}`, {
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

  const countFor = (queueType: string) => queues.find((q) => q.queueType === queueType)?.count || 0;

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Catalog governance"
        title="Review queues"
        description="Classification, OEM parsing, authenticity, and match conflicts from seller imports and seed runs."
        actions={
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-graphite-600">Open tasks</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{openTotal}</p>
          </div>
        }
      />

      {error && (
        <p className="break-anywhere rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-6">
        {/*
          Below xl the queue picker is a horizontal snap rail rather than a
          stacked list: eight full-width rows would have pushed the tasks
          themselves two screens down on a phone.
        */}
        <nav aria-label="Review queues" className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 xl:mb-3">Queues</h2>
          <ul className="scroll-rail gap-2 pb-1 xl:flex-col xl:gap-1 xl:overflow-visible xl:rounded-xl xl:border xl:border-slate-200 xl:bg-white xl:p-3">
            {REVIEW_QUEUE_TYPES.map((queueType) => {
              const active = activeQueue === queueType;
              const count = countFor(queueType);
              return (
                <li key={queueType} className="xl:w-full">
                  <button
                    type="button"
                    onClick={() => setActiveQueue(queueType)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-h-touch w-full items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      'xl:justify-between xl:whitespace-normal xl:border-transparent',
                      active
                        ? 'border-blue-200 bg-blue-50 font-semibold text-blue-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 xl:bg-transparent',
                    )}
                  >
                    <span className="min-w-0">{queueType.replace(/_/g, ' ')}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 text-xs tabular-nums',
                        active ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-graphite-600',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-900">{activeQueue.replace(/_/g, ' ')}</h2>
          </div>
          {loading ? (
            <div className="space-y-4 px-4 py-5 sm:px-5" aria-busy="true">
              <SkeletonText lines={3} />
              <SkeletonText lines={3} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={<CheckCircleIcon />}
                title="Queue is clear"
                description="No open tasks in this queue right now."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <li key={task.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge size="sm" tone="outline">{task.severity}</Badge>
                        {typeof task.confidence === 'number' && (
                          <span className="text-xs tabular-nums text-graphite-600">
                            Confidence {(task.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 text-pretty text-sm font-semibold text-slate-900">{task.title}</h3>
                      {task.description && (
                        <p className="mt-1 text-pretty text-sm text-graphite-600">{task.description}</p>
                      )}
                      {/* break-anywhere: manufacturer part numbers routinely
                          exceed the card width on a 320px screen. */}
                      <p className="mt-2 break-anywhere text-xs text-graphite-600">
                        {task.seller?.name || 'Unknown seller'}
                        {task.canonicalPart
                          ? ` · ${task.canonicalPart.brand || 'No brand'} · ${task.canonicalPart.manufacturerPartNumber || task.canonicalPart.title} · ${partTypeLabel(task.canonicalPart.partType)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:shrink-0">
                      <Button
                        size="sm"
                        loading={resolving === task.id}
                        onClick={() => resolve(task.id, 'RESOLVED')}
                      >
                        Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolving === task.id}
                        onClick={() => resolve(task.id, 'DISMISSED')}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageBody>
  );
}
