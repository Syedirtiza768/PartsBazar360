"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';

interface UploadRow {
  id: string;
  rowNumber: number;
  status: string;
  sku?: string | null;
  title?: string | null;
  partSource?: string | null;
  qualityTier?: string | null;
  price?: number | null;
  quantity?: number | null;
  message?: string | null;
}

interface UploadJob {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  insertedRows: number;
  reviewRows: number;
  invalidRows: number;
  defaultPartSource: string;
  defaultQualityTier: string;
  createdAt: string;
  completedAt?: string | null;
  rows?: UploadRow[];
}

const statusClass: Record<string, string> = {
  COMPLETED: 'bg-emerald-500/10 text-emerald-400',
  NEEDS_REVIEW: 'bg-amber-500/10 text-amber-300',
  FAILED: 'bg-red-500/10 text-red-400',
  PROCESSING: 'bg-blue-500/10 text-blue-300',
  IMPORTED: 'bg-emerald-500/10 text-emerald-400',
  INVALID: 'bg-red-500/10 text-red-400',
  APPROVED: 'bg-emerald-500/10 text-emerald-400',
};

export default function UploadsPage() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<UploadJob | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [defaultPartSource, setDefaultPartSource] = useState('OEM');
  const [defaultQualityTier, setDefaultQualityTier] = useState('USED');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => ({
    imported: jobs.reduce((sum, job) => sum + (job.insertedRows || 0), 0),
    review: jobs.reduce((sum, job) => sum + (job.reviewRows || 0), 0),
    invalid: jobs.reduce((sum, job) => sum + (job.invalidRows || 0), 0),
  }), [jobs]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads?sellerId=${DEMO_SELLER_ID}`);
      const data = await res.json();
      const nextJobs = Array.isArray(data) ? data : [];
      setJobs(nextJobs);
      setSelectedJob((current) => current || nextJobs[0] || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] || null);
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError('Choose a CSV file first.');
      return;
    }

    const body = new FormData();
    body.append('sellerId', DEMO_SELLER_ID);
    body.append('defaultPartSource', defaultPartSource);
    body.append('defaultQualityTier', defaultQualityTier);
    body.append('file', file);

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed.');
      setSelectedJob(data);
      setFile(null);
      await loadJobs();
    } catch (err: any) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (row: UploadRow) => {
    await fetch(`${API_BASE_URL}/merchant/uploads/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'APPROVED',
        offerStatus: 'ACTIVE',
        notes: 'Approved by seller after compatibility review.',
      }),
    });
    if (selectedJob) {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads/${selectedJob.id}`);
      const data = await res.json();
      setSelectedJob(data);
    }
    await loadJobs();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Listing Upload Pipeline</h1>
        <p className="text-zinc-400 mt-1">
          Upload seller files, enrich listings with OEM and aftermarket metadata, and review compatibility exceptions before they go live.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400">Imported Listings</h3>
          <div className="text-4xl font-bold mt-2 text-emerald-400">{stats.imported}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400">Compatibility Review</h3>
          <div className="text-4xl font-bold mt-2 text-amber-300">{stats.review}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400">Invalid Rows</h3>
          <div className="text-4xl font-bold mt-2 text-red-400">{stats.invalid}</div>
        </div>
      </div>

      <form onSubmit={handleUpload} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <label className="lg:col-span-2 block">
            <span className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="block w-full text-sm text-zinc-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-zinc-950 hover:file:bg-zinc-200" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Default source</span>
            <select value={defaultPartSource} onChange={(event) => setDefaultPartSource(event.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500">
              <option value="OEM">OEM</option>
              <option value="AFTERMARKET">Aftermarket</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Default quality</span>
            <select value={defaultQualityTier} onChange={(event) => setDefaultQualityTier(event.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500">
              <option value="USED">Used</option>
              <option value="NEW">New</option>
              <option value="REFURBISHED">Refurbished</option>
              <option value="REMANUFACTURED">Remanufactured</option>
              <option value="FOR_PARTS">For parts</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Supported columns include title, sku, price, quantity, brand, OEM part number, condition, part type, currency, and image URLs.
          </p>
          <button disabled={submitting} className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-60">
            {submitting ? 'Processing...' : 'Upload and enrich'}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Upload Jobs</h2>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-sm text-zinc-500">Loading uploads...</p>
          ) : jobs.length === 0 ? (
            <p className="px-6 py-8 text-sm text-zinc-500">No uploads yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button onClick={() => setSelectedJob(job)} className="w-full px-6 py-4 text-left hover:bg-zinc-800/60">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white truncate">{job.fileName}</p>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusClass[job.status] || 'bg-zinc-800 text-zinc-300'}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{job.insertedRows} imported, {job.reviewRows} review, {job.invalidRows} invalid</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="xl:col-span-2 bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">Rows Needing Attention</h2>
            {selectedJob && <span className="text-xs text-zinc-500 font-mono">{selectedJob.id}</span>}
          </div>
          {!selectedJob ? (
            <p className="px-6 py-8 text-sm text-zinc-500">Select an upload job to inspect rows.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="px-6 py-4 font-medium">Row</th>
                    <th className="px-6 py-4 font-medium">Listing</th>
                    <th className="px-6 py-4 font-medium">Type</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {(selectedJob.rows || []).map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="px-6 py-4 text-zinc-400">{row.rowNumber}</td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-white">{row.title || row.sku || 'Untitled row'}</p>
                        <p className="text-xs text-zinc-500">{row.message || `${row.quantity || 0} in stock`}</p>
                      </td>
                      <td className="px-6 py-4 text-zinc-300">{row.partSource || 'OEM'} / {row.qualityTier || 'USED'}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass[row.status] || 'bg-zinc-800 text-zinc-300'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {row.status === 'NEEDS_REVIEW' ? (
                          <button onClick={() => handleReview(row)} className="text-sm font-medium text-emerald-400 hover:text-emerald-300">Approve</button>
                        ) : (
                          <span className="text-xs text-zinc-600">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(selectedJob.rows || []).length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-zinc-500">No rows loaded for this job.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
