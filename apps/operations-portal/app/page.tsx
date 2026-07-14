"use client";

import { useState } from 'react';
import { API_BASE_URL } from '@/lib/api';

interface SyncResult {
  message: string;
  jobId: string;
  storeId: string;
}

export default function CatalogueSyncPage() {
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SyncResult[]>([]);

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
    } catch (err: any) {
      setError(err?.message || 'Failed to queue sync job.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">RealTrack Catalogue Sync</h1>
        <p className="text-zinc-400 mt-1">Queue an ingestion job to pull the latest listings from a RealTrack store.</p>
      </header>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 backdrop-blur-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Store ID</label>
            <input
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="e.g. store-1"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Start Page</label>
            <input
              type="number"
              min={1}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <button
          onClick={handleTriggerSync}
          disabled={submitting}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Queuing job...' : 'Trigger Sync'}
        </button>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {result && (
          <p className="text-sm text-emerald-400">
            Queued job <span className="font-mono">{result.jobId}</span> for store {result.storeId}.
          </p>
        )}
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Recent Jobs (this session)</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-6 py-8 text-center text-zinc-500 text-sm">No sync jobs queued yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {history.map((item, idx) => (
              <li key={`${item.jobId}-${idx}`} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Store: {item.storeId}</p>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5">Job {item.jobId}</p>
                </div>
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                  Queued
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
