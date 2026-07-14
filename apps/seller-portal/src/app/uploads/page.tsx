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
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-100',
  FAILED: 'bg-red-50 text-red-700 border-red-100',
  PROCESSING: 'bg-blue-50 text-blue-700 border-blue-100',
  IMPORTED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  INVALID: 'bg-red-50 text-red-700 border-red-100',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
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
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Seller Intake</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Listing upload pipeline</h1>
          <p className="text-slate-600 mt-1">
            Upload seller files, enrich listings, and review compatibility exceptions before they go live.
          </p>
        </div>
        <button onClick={loadJobs} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
          Refresh pipeline
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard label="Imported listings" value={stats.imported} tone="text-emerald-700" />
        <MetricCard label="Compatibility review" value={stats.review} tone="text-amber-700" />
        <MetricCard label="Invalid rows" value={stats.invalid} tone="text-red-700" />
      </div>

      <form onSubmit={handleUpload} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <label className="lg:col-span-2 block">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-500" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Default source</span>
            <select value={defaultPartSource} onChange={(event) => setDefaultPartSource(event.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="OEM">OEM</option>
              <option value="AFTERMARKET">Aftermarket</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Default quality</span>
            <select value={defaultQualityTier} onChange={(event) => setDefaultQualityTier(event.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="USED">Used</option>
              <option value="NEW">New</option>
              <option value="REFURBISHED">Refurbished</option>
              <option value="REMANUFACTURED">Remanufactured</option>
              <option value="FOR_PARTS">For parts</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Supported columns include title, sku, price, quantity, brand, OEM part number, condition, part type, currency, and image URLs.
          </p>
          <button disabled={submitting} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors">
            {submitting ? 'Processing...' : 'Upload and enrich'}
          </button>
        </div>
        {error && <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      </form>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="font-semibold text-sm text-slate-600 uppercase tracking-wider">Upload jobs</h2>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-sm text-slate-500">Loading uploads...</p>
          ) : jobs.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-500">No uploads yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button onClick={() => setSelectedJob(job)} className="w-full px-6 py-4 text-left hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-950 truncate">{job.fileName}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${statusClass[job.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{job.insertedRows} imported, {job.reviewRows} review, {job.invalidRows} invalid</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="xl:col-span-2 rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
            <h2 className="font-semibold text-sm text-slate-600 uppercase tracking-wider">Rows needing attention</h2>
            {selectedJob && <span className="text-xs text-slate-500 font-mono truncate max-w-[220px]">{selectedJob.id}</span>}
          </div>
          {!selectedJob ? (
            <p className="px-6 py-8 text-sm text-slate-500">Select an upload job to inspect rows.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-white border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Row</th>
                    <th className="px-6 py-4 font-semibold">Listing</th>
                    <th className="px-6 py-4 font-semibold">Type</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedJob.rows || []).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-500">{row.rowNumber}</td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-950">{row.title || row.sku || 'Untitled row'}</p>
                        <p className="text-xs text-slate-500">{row.message || `${row.quantity || 0} in stock`}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{row.partSource || 'OEM'} / {row.qualityTier || 'USED'}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass[row.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {row.status === 'NEEDS_REVIEW' ? (
                          <button onClick={() => handleReview(row)} className="text-sm font-semibold text-emerald-700 hover:text-emerald-600">Approve</button>
                        ) : (
                          <span className="text-xs text-slate-400">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(selectedJob.rows || []).length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No rows loaded for this job.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-medium text-slate-500">{label}</h3>
      <div className={`text-4xl font-bold mt-2 ${tone}`}>{value}</div>
    </div>
  );
}
