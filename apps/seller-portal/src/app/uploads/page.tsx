"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { DataTable, type Column } from "@repo/ui/data-table";
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
    // Mount-only: loadJobs/openJob are recreated every render, so listing them
    // would re-fetch the whole pipeline on each keystroke in the upload form.
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

  /*
   * Row columns drive both the table (xl+) and the mobile card list. The
   * listing title is the card heading, the type/status chips form the meta
   * line, and Approve stays a full 44px action in both — previously it lived
   * in a `min-w-[640px]` table that a phone could only reach by sideways
   * scrolling past four columns.
   */
  const rowColumns: Column<UploadRow>[] = [
    {
      key: "row",
      header: "Row",
      align: "right",
      cell: (row) => <span className="tabular-nums text-graphite-600">{row.rowNumber}</span>,
    },
    {
      key: "listing",
      header: "Listing",
      priority: "primary",
      className: "max-w-[300px]",
      cell: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium text-slate-900">
            {row.title || row.sku || "Untitled row"}
          </p>
          <p className="mt-0.5 text-pretty text-xs text-graphite-600">
            {row.message || `${row.quantity || 0} in stock`}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      priority: "secondary",
      cell: (row) => (
        <span className="text-xs text-graphite-600">
          {(row.partSource || "OEM") === "OEM" ? "Genuine OEM" : "Aftermarket"} ·{" "}
          <span className="capitalize">
            {(row.qualityTier || "USED").replace(/_/g, " ").toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      priority: "secondary",
      cell: (row) => <StatusBadge status={row.status} size="sm" />,
    },
  ];

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
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

      {/* Two up on phones (the third wraps full-width), three from sm. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Imported listings" value={stats.imported} tone="success" loading={loading} />
        <StatCard label="Compatibility review" value={stats.review} tone="warning" loading={loading} />
        <StatCard label="Invalid rows" value={stats.invalid} loading={loading} className="col-span-2 sm:col-span-1" />
      </div>

      {/* Upload form */}
      <form onSubmit={handleUpload} className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">New upload</h2>
          <p className="mt-1 text-pretty text-sm text-graphite-600">
            Supported: CSV and Excel (.xlsx). DXB-EXW and FEBEST templates are auto-detected.
            Staged mode previews classification and matches before live catalog writes.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Inventory file</span>
            {/*
              The drop zone is a <label> wrapping a visually hidden file input,
              so the whole 44px+ area is the tap target and the native picker
              (which on mobile also offers camera/Files) still opens.
            */}
            <label
              className={cn(
                "flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
                "focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2",
                file ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/50",
              )}
            >
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} className="sr-only" />
              {file ? (
                <>
                  <FileTextIcon className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    {/* break-anywhere: exported filenames routinely run past
                        40 characters and must stay identifiable. */}
                    <span className="block break-anywhere text-sm font-semibold text-slate-900">{file.name}</span>
                    <span className="text-xs text-graphite-600">{(file.size / 1024).toFixed(1)} KB — tap to change</span>
                  </span>
                </>
              ) : (
                <>
                  <UploadIcon className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="text-sm text-graphite-600">
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
          <Button type="submit" loading={submitting} disabled={!file && !submitting} fullWidth className="sm:w-auto">
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
            /* Capped by viewport height rather than a fixed 480px, so on a
               landscape phone the list scrolls internally instead of pushing
               the row detail off the page. */
            <ul className="max-h-[min(30rem,55dvh)] divide-y divide-slate-100 overflow-y-auto overscroll-none-y xl:max-h-[30rem]">
              {jobs!.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => openJob(job)}
                    aria-current={selectedJob?.id === job.id || undefined}
                    className={cn(
                      "w-full min-h-touch px-4 py-3.5 text-left transition-colors sm:px-5",
                      selectedJob?.id === job.id ? "bg-brand-50/60" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-anywhere text-sm font-semibold text-slate-900">{job.fileName}</p>
                      <span className="shrink-0">
                        <StatusBadge status={job.status} size="sm" />
                      </span>
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-graphite-600">
                      {job.insertedRows} imported · {job.reviewRows} review · {job.invalidRows} invalid
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card xl:col-span-2" aria-label="Rows needing attention">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-900">Rows needing attention</h2>
            <div className="flex min-w-0 items-center gap-3">
              {selectedJob && (
                <span className="part-number min-w-0 truncate text-graphite-600 sm:max-w-[200px]">
                  {selectedJob.fileName}
                </span>
              )}
              {selectedJob?.status === "PREVIEW_READY" && (
                <Button size="sm" onClick={handleCommit} loading={committing}>
                  Commit import
                </Button>
              )}
            </div>
          </div>

          {!selectedJob ? (
            <p className="px-4 py-10 text-center text-sm text-graphite-600 sm:px-5">
              Select an upload job to inspect its rows.
            </p>
          ) : loadingRows ? (
            <div className="flex justify-center px-4 py-10 sm:px-5">
              <Spinner label="Loading rows…" />
            </div>
          ) : (
            <DataTable
              caption="Upload rows"
              rows={selectedJob.rows || []}
              columns={rowColumns}
              getRowKey={(row) => row.id}
              tableFrom="xl"
              className="p-3 xl:p-0 [&_[role=region]]:rounded-none [&_[role=region]]:border-0"
              actions={(row) =>
                row.status === "NEEDS_REVIEW" ? (
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
                  <span className="text-xs text-graphite-600">No action</span>
                )
              }
              empty={
                <p className="px-4 py-10 text-center text-sm text-graphite-600 sm:px-5">
                  No rows loaded for this job.
                </p>
              }
            />
          )}
        </section>
      </div>
    </PageBody>
  );
}
