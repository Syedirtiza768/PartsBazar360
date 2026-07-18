"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { Select } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { UploadIcon, RefreshIcon, FileTextIcon, CheckIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

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
  commitMode?: string;
  preview?: Record<string, unknown> | null;
  createdAt: string;
  completedAt?: string | null;
  rows?: UploadRow[];
}

export default function UploadsPage() {
  const [jobs, setJobs] = useState<UploadJob[] | null>(null);
  const [selectedJob, setSelectedJob] = useState<UploadJob | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [defaultPartSource, setDefaultPartSource] = useState("OEM");
  const [defaultQualityTier, setDefaultQualityTier] = useState("USED");
  const [commitMode, setCommitMode] = useState<"IMMEDIATE" | "STAGED">("STAGED");
  const [submitting, setSubmitting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [approvingRow, setApprovingRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loading = jobs === null && !loadError;

  const stats = useMemo(
    () => ({
      imported: (jobs ?? []).reduce((sum, job) => sum + (job.insertedRows || 0), 0),
      review: (jobs ?? []).reduce((sum, job) => sum + (job.reviewRows || 0), 0),
      invalid: (jobs ?? []).reduce((sum, job) => sum + (job.invalidRows || 0), 0),
    }),
    [jobs],
  );

  const loadJobs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads?sellerId=${DEMO_SELLER_ID}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const nextJobs: UploadJob[] = Array.isArray(data) ? data : [];
      setJobs(nextJobs);
      setLoadError(false);
      setSelectedJob((current) => current ?? nextJobs[0] ?? null);
      return nextJobs;
    } catch {
      setLoadError(true);
      return [];
    }
  };

  // Job list rows don't include row details — fetch them when a job is opened.
  const openJob = async (job: UploadJob) => {
    setSelectedJob(job);
    if (job.rows && job.rows.length > 0) return;
    setLoadingRows(true);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads/${job.id}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedJob(detail);
      }
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    loadJobs().then((initial) => {
      if (initial[0]) openJob(initial[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] || null);
    setError(null);
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV or Excel file first.");
      return;
    }

    const body = new FormData();
    body.append("sellerId", DEMO_SELLER_ID);
    body.append("defaultPartSource", defaultPartSource);
    body.append("defaultQualityTier", defaultQualityTier);
    body.append("commitMode", commitMode);
    body.append("catalogType", defaultPartSource === "AFTERMARKET" ? "AFTERMARKET" : "MIXED");
    body.append("file", file);

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed.");
      setSelectedJob(data);
      setFile(null);
      await loadJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (row: UploadRow) => {
    setApprovingRow(row.id);
    try {
      await fetch(`${API_BASE_URL}/merchant/uploads/rows/${row.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "APPROVED",
          offerStatus: "ACTIVE",
          notes: "Approved by seller after compatibility review.",
        }),
      });
      if (selectedJob) {
        const res = await fetch(`${API_BASE_URL}/merchant/uploads/${selectedJob.id}`);
        if (res.ok) setSelectedJob(await res.json());
      }
      await loadJobs();
    } finally {
      setApprovingRow(null);
    }
  };

  const handleCommit = async () => {
    if (!selectedJob) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/merchant/uploads/${selectedJob.id}/commit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Commit failed.");
      setSelectedJob(data);
      await loadJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Seller intake"
        title="Listing upload pipeline"
        description="Upload seller files, enrich listings, and review compatibility exceptions before they go live."
        actions={
          <Button variant="outline" onClick={loadJobs}>
            <RefreshIcon className="h-4 w-4" />
            Refresh pipeline
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        <StatCard label="Imported listings" value={stats.imported} tone="success" loading={loading} />
        <StatCard label="Compatibility review" value={stats.review} tone="warning" loading={loading} />
        <StatCard label="Invalid rows" value={stats.invalid} loading={loading} />
      </div>

      {/* Upload form */}
      <form onSubmit={handleUpload} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">New upload</h2>
          <p className="mt-1 text-sm text-slate-500">
            Supported: CSV and Excel (.xlsx). DXB-EXW and FEBEST templates are auto-detected.
            Staged mode previews classification and matches before live catalog writes.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Inventory file</span>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
                file ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/50",
              )}
            >
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} className="sr-only" />
              {file ? (
                <>
                  <FileTextIcon className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{file.name}</span>
                    <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB — click to change</span>
                  </span>
                </>
              ) : (
                <>
                  <UploadIcon className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="text-sm text-slate-600">
                    <span className="font-semibold text-brand-600">Choose a CSV or XLSX file</span> to upload
                  </span>
                </>
              )}
            </label>
          </div>

          <Select label="Default source" value={defaultPartSource} onChange={(e) => setDefaultPartSource(e.target.value)}>
            <option value="OEM">Genuine OEM</option>
            <option value="AFTERMARKET">Aftermarket</option>
            <option value="MIXED">Mixed catalog</option>
          </Select>

          <Select label="Default quality" value={defaultQualityTier} onChange={(e) => setDefaultQualityTier(e.target.value)}>
            <option value="USED">Used</option>
            <option value="NEW">New</option>
            <option value="REFURBISHED">Refurbished</option>
            <option value="REMANUFACTURED">Remanufactured</option>
            <option value="FOR_PARTS">For parts</option>
          </Select>

          <Select label="Commit mode" value={commitMode} onChange={(e) => setCommitMode(e.target.value as "IMMEDIATE" | "STAGED")}>
            <option value="STAGED">Stage then preview</option>
            <option value="IMMEDIATE">Import immediately</option>
          </Select>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={submitting} disabled={!file && !submitting}>
            <UploadIcon className="h-4 w-4" />
            Upload &amp; enrich
          </Button>
        </div>
      </form>

      {/* Jobs + rows */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card" aria-label="Upload jobs">
          <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-900">Upload jobs</h2>
          </div>
          {loadError ? (
            <p className="px-5 py-8 text-sm font-medium text-red-700">Couldn&apos;t load uploads. Refresh to try again.</p>
          ) : loading ? (
            <div className="space-y-3 p-5" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : jobs!.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<UploadIcon />} title="No uploads yet" description="Your first CSV import will appear here." />
            </div>
          ) : (
            <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
              {jobs!.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => openJob(job)}
                    aria-current={selectedJob?.id === job.id || undefined}
                    className={cn(
                      "w-full px-5 py-3.5 text-left transition-colors",
                      selectedJob?.id === job.id ? "bg-brand-50/60" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{job.fileName}</p>
                      <StatusBadge status={job.status} size="sm" />
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-slate-500">
                      {job.insertedRows} imported · {job.reviewRows} review · {job.invalidRows} invalid
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card xl:col-span-2" aria-label="Rows needing attention">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-900">Rows needing attention</h2>
            <div className="flex items-center gap-3">
              {selectedJob && (
                <span className="part-number max-w-[200px] truncate text-slate-400">{selectedJob.fileName}</span>
              )}
              {selectedJob?.status === "PREVIEW_READY" && (
                <Button size="sm" onClick={handleCommit} loading={committing}>
                  Commit import
                </Button>
              )}
            </div>
          </div>

          {!selectedJob ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Select an upload job to inspect its rows.</p>
          ) : loadingRows ? (
            <div className="flex justify-center px-5 py-10">
              <Spinner label="Loading rows…" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Row</th>
                    <th className="px-5 py-3">Listing</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedJob.rows || []).map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-5 py-3.5 tabular-nums text-slate-500">{row.rowNumber}</td>
                      <td className="max-w-[300px] px-5 py-3.5">
                        <p className="truncate font-medium text-slate-900">{row.title || row.sku || "Untitled row"}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {row.message || `${row.quantity || 0} in stock`}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">
                        {(row.partSource || "OEM") === "OEM" ? "Genuine OEM" : "Aftermarket"} ·{" "}
                        <span className="capitalize">{(row.qualityTier || "USED").replace(/_/g, " ").toLowerCase()}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={row.status} size="sm" />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {row.status === "NEEDS_REVIEW" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleApprove(row)}
                            loading={approvingRow === row.id}
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                            Approve
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(selectedJob.rows || []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                        No rows loaded for this job.
                      </td>
                    </tr>
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
