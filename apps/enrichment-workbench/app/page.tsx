"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompatibilityRow,
  ListingDetail,
  ListingStats,
  ListingSummary,
  HighConfidenceFitment,
} from "@/lib/types";
import { assessSeoTitle, buildSeoTitle, SEO_TITLE_MAX_LENGTH, SEO_TITLE_TEMPLATE } from "@/lib/title-quality";

interface ListingsResponse {
  items: ListingSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  stats: ListingStats;
  source: {
    generatedAt: string;
    sourceFile: string;
    totalListings: number;
  };
}

interface CompatibilityLookupResponse {
  matchedBy?: "BRAND_MPN";
  matchedOeNumber: string;
  matchedBrand?: string;
  matchedManufacturerPartNumber?: string;
  sourceTitle: string;
  confidence: number;
  compatibility: CompatibilityRow[];
}

const EMPTY_STATS: ListingStats = {
  total: 0,
  unreviewed: 0,
  draft: 0,
  approved: 0,
  ready: 0,
  needsTitle: 0,
  needsImage: 0,
  needsCompatibility: 0,
};

const FILTERS = [
  ["all", "All listings"],
  ["needs-title", "Needs title"],
  ["needs-image", "Needs image"],
  ["needs-compatibility", "Needs compatibility"],
  ["ready", "Ready to approve"],
  ["draft", "Drafts"],
  ["approved", "Approved"],
] as const;


const TITLE_CHECKS = [
  ["format", "4-part format"],
  ["brand", "Brand"],
  ["description", "Description"],
  ["oeNumber", "OE number"],
  ["fitment", "Make + model"],
  ["concise", `≤ ${SEO_TITLE_MAX_LENGTH} characters`],
] as const;
function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function readinessLabel(item: ListingSummary) {
  if (item.status === "approved") return { text: "Approved", tone: "good" };
  if (item.readiness.ready) return { text: "Ready", tone: "good" };
  const missing = [
    !item.readiness.title && "title",
    !item.readiness.image && "image",
    !item.readiness.compatibility && "fitment",
  ].filter(Boolean);
  return { text: `Needs ${missing.join(" + ")}`, tone: "warning" };
}

function newCompatibilityRow(): CompatibilityRow {
  return {
    id: `fitment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    yearStart: "",
    yearEnd: "",
    make: "",
    model: "",
    trim: "",
    engine: "",
    notes: "",
  };
}

function ImageThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="image-placeholder" aria-label="No image available">
        <span>PART</span>
      </div>
    );
  }
  // The source URLs are the inventory data under review, so a plain img is intentional here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

interface HighConfidenceResponse {
  items: HighConfidenceFitment[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: {
    totalResults: number;
    fitmentRows: number;
  };
}

function confidencePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function fitmentLabel(row: HighConfidenceFitment["fitment"][number]) {
  const years = row.yearStart && row.yearEnd && row.yearStart !== row.yearEnd
    ? `${row.yearStart}–${row.yearEnd}`
    : row.yearStart || row.yearEnd;
  const vehicle = [row.make, row.model].filter(Boolean).join(" ");
  return `${vehicle}${years ? ` · ${years}` : ""}${row.trim ? ` · ${row.trim}` : ""}`;
}

function HighConfidencePanel() {
  const [data, setData] = useState<HighConfidenceResponse | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(queryInput);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ q: query, page: String(page), pageSize: "24" });
    fetch(`/api/high-confidence?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load high-confidence fitments");
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load high-confidence fitments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, query]);

  return (
    <section className="high-confidence-panel" aria-labelledby="high-confidence-heading">
      <div className="high-confidence-intro">
        <div>
          <p className="eyebrow">Verified evidence queue</p>
          <h2 id="high-confidence-heading">High-confidence fitment results</h2>
          <p>Exact Brand + MPN research with identity and fitment confidence of at least 85%. These rows are read-only evidence for title and compatibility review.</p>
        </div>
        <div className="confidence-summary">
          <strong>{formatCount(data?.summary.totalResults || 0)}</strong>
          <span>verified Brand + MPN pairs</span>
          <small>{formatCount(data?.summary.fitmentRows || 0)} vehicle rows</small>
        </div>
      </div>

      <div className="high-confidence-toolbar">
        <label className="search-field">
          <span className="sr-only">Search high-confidence fitments</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search brand, MPN, OE, make, or model…"
          />
          {queryInput && <button type="button" onClick={() => setQueryInput("")} aria-label="Clear search">×</button>}
        </label>
        <div className="result-count">{data ? `${formatCount(data.total)} matches` : "Loading results"}</div>
      </div>

      {error ? (
        <div className="empty-state error-state"><strong>Fitment results unavailable</strong><p>{error}</p></div>
      ) : loading && !data ? (
        <div className="high-confidence-loading"><div className="spinner" /><p>Loading verified fitment evidence…</p></div>
      ) : data?.items.length === 0 ? (
        <div className="empty-state"><strong>No high-confidence matches</strong><p>Try a different brand, MPN, OE number, make, or model.</p></div>
      ) : (
        <div className="high-confidence-list">
          {data?.items.map((item) => (
            <article className="high-confidence-card" key={item.key}>
              <div className="confidence-card-head">
                <div className="confidence-part">
                  <span className="confidence-brand">{item.brand}</span>
                  <h3>{item.productDescription}</h3>
                  <p>{item.mpn}</p>
                </div>
                <div className="confidence-badges" aria-label="Confidence scores">
                  <span>Identity {confidencePercent(item.identityConfidence)}</span>
                  <span>Fitment {confidencePercent(item.fitmentConfidence)}</span>
                </div>
              </div>
              <div className="confidence-card-grid">
                <div>
                  <span className="confidence-label">Verified vehicle fitment</span>
                  <ul className="fitment-chip-list">
                    {item.fitment.map((row) => <li key={row.id}>{fitmentLabel(row)}</li>)}
                  </ul>
                </div>
                <div>
                  <span className="confidence-label">OE references</span>
                  {item.oeNumbers.length > 0 ? (
                    <div className="oe-chip-list">{item.oeNumbers.map((oe) => <span key={oe}>{oe}</span>)}</div>
                  ) : <p className="confidence-muted">OE not available</p>}
                </div>
                <div>
                  <span className="confidence-label">Evidence</span>
                  <p className="confidence-evidence">{item.evidenceBasis || "Exact Brand + MPN evidence accepted."}</p>
                  {item.sourceUrls[0] && <a className="confidence-source" href={item.sourceUrls[0]} target="_blank" rel="noreferrer">View source ↗</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && data.pageCount > 1 && (
        <nav className="pagination" aria-label="High-confidence pages">
          <button type="button" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button>
          <span>Page <strong>{data.page}</strong> of {formatCount(data.pageCount)}</span>
          <button type="button" disabled={data.page >= data.pageCount} onClick={() => setPage((value) => value + 1)}>Next →</button>
        </nav>
      )}
    </section>
  );
}
export default function WorkbenchPage() {
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"catalog" | "high-confidence">("catalog");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");

  const [oeLookupState, setOeLookupState] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [oeLookupMessage, setOeLookupMessage] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(queryInput);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, filter, page: String(page), pageSize: "24" });
      const response = await fetch(`/api/listings?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load listings");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load listings");
    } finally {
      setLoading(false);
    }
  }, [filter, page, query]);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setSaveState("idle");
    fetch(`/api/listings/${selectedId}`, { cache: "no-store" })
      .then(async (response) => {
    setOeLookupState("idle");
    setOeLookupMessage("");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load listing");
        if (!cancelled) setDetail(payload);
      })
      .catch((caught) => {
        if (!cancelled) {
          setSaveState("error");
          setSaveMessage(caught instanceof Error ? caught.message : "Unable to load listing");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedId]);

  const stats = data?.stats || EMPTY_STATS;
  const resultLabel = useMemo(() => {
    if (!data) return "Loading catalogue";
    return `${formatCount(data.total)} ${data.total === 1 ? "listing" : "listings"}`;
  }, [data]);

  function updateDetail(patch: Partial<ListingDetail>) {
    setDetail((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      const compatibilityReady =
        next.universalFitment ||
        next.compatibility.some((row) => row.yearStart.trim() && row.make.trim() && row.model.trim());
      const titleChecks = assessSeoTitle({
        ...next,
        sourceCompatibilityReady: next.existingCompatibilityReady,
      });
      const readiness = {
        title: titleChecks.complete,
        titleChecks,
        image: next.imageUrls.some((url) => /^https?:\/\//i.test(url.trim())),
        compatibility: Boolean(compatibilityReady),
        ready: false,
      };
      readiness.ready = readiness.title && readiness.image && readiness.compatibility;
      return { ...next, compatibilityCount: next.compatibility.length, readiness };
    });
    setSaveState("idle");
    setSaveMessage("");
  }

  function updateCompatibility(id: string, patch: Partial<CompatibilityRow>) {
    if (!detail) return;
    updateDetail({
      compatibility: detail.compatibility.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  async function lookupCompatibility() {
    if (!detail) return;
    setOeLookupState("loading");
    setOeLookupMessage("");
    try {
      const hasOe = detail.oemPartNumber.trim().length >= 5;
      const params = hasOe
        ? new URLSearchParams({ oe: detail.oemPartNumber.trim() })
        : new URLSearchParams({
            brand: detail.brand || detail.manufacturer,
            mpn: detail.manufacturerPartNumber,
          });
      const response = await fetch(`/api/compatibility-lookup?${params}`, { cache: "no-store" });
      const payload = (await response.json()) as CompatibilityLookupResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to find compatibility");
      const confirmedOe = detail.oemPartNumber.trim() || payload.matchedOeNumber || "";
      const next = {
        ...detail,
        oemPartNumber: confirmedOe,
        compatibility: payload.compatibility,
        universalFitment: false,
      };
      updateDetail({
        oemPartNumber: confirmedOe,
        compatibility: payload.compatibility,
        universalFitment: false,
        title: buildSeoTitle(next),
      });
      setOeLookupState("found");
      const evidence = payload.matchedBy === "BRAND_MPN"
        ? `${payload.matchedBrand || detail.brand} ${payload.matchedManufacturerPartNumber || detail.manufacturerPartNumber}`
        : `OE ${payload.matchedOeNumber}`;
      setOeLookupMessage(
        `Found ${formatCount(payload.compatibility.length)} confirmed fitments via ${evidence}.`,
      );
    } catch (caught) {
      setOeLookupState("error");
      setOeLookupMessage(caught instanceof Error ? caught.message : "Unable to find compatibility");
    }
  }

  async function save(status: "draft" | "approved") {
    if (!detail) return;
    setSaveState("saving");
    setSaveMessage("");
    try {
      const response = await fetch(`/api/listings/${detail.listingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: detail.title,
          imageUrls: detail.imageUrls,
          oemPartNumber: detail.oemPartNumber,
          compatibility: detail.compatibility,
          universalFitment: detail.universalFitment,
          reviewerNote: detail.reviewerNote,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save listing");
      setDetail(payload);
      setSaveState("saved");
      setSaveMessage(status === "approved" ? "Approved and added to the export." : "Draft saved locally.");
      await loadListings();
    } catch (caught) {
      setSaveState("error");
      setSaveMessage(caught instanceof Error ? caught.message : "Unable to save listing");
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">S</div>
          <div>
            <strong>Superior enrichment desk</strong>
            <span>Local working copy · production remains unchanged</span>
          </div>
        </div>
        <a className="button secondary" href="/api/export">
          Export approved CSV
        </a>
      </header>

      <div className="workspace-shell">
        <section className="hero">
          <div>
            <p className="eyebrow">Catalogue quality workspace</p>
            <h1>Turn every part into a listing customers can trust.</h1>
            <p className="hero-copy">
              Review titles, confirm product images, and add vehicle compatibility. Every change stays local until
              you approve and export it.
            </p>
          </div>
          <div className="source-note">
            <span className="pulse" />
            <div>
              <strong>{formatCount(stats.total)} Superior listings loaded</strong>
              <small>{data?.source ? `Indexed ${new Date(data.source.generatedAt).toLocaleString()}` : "Preparing source data"}</small>
            </div>
          </div>
        </section>

        <nav className="workspace-tabs" aria-label="Workbench views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "catalog"}
            className={activeTab === "catalog" ? "active" : ""}
            onClick={() => setActiveTab("catalog")}
          >
            Catalogue review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "high-confidence"}
            className={activeTab === "high-confidence" ? "active" : ""}
            onClick={() => setActiveTab("high-confidence")}
          >
            High-confidence fitment
          </button>
        </nav>

        {activeTab === "high-confidence" ? (
          <HighConfidencePanel />
        ) : (
          <>        <section className="metrics" aria-label="Enrichment progress">
          <button type="button" onClick={() => { setFilter("all"); setPage(1); }}>
            <span>All listings</span><strong>{formatCount(stats.total)}</strong><small>Full Superior catalogue</small>
          </button>
          <button type="button" onClick={() => { setFilter("needs-image"); setPage(1); }}>
            <span>Missing images</span><strong>{formatCount(stats.needsImage)}</strong><small>Need a confirmed photo</small>
          </button>
          <button type="button" onClick={() => { setFilter("needs-compatibility"); setPage(1); }}>
            <span>Missing compatibility</span><strong>{formatCount(stats.needsCompatibility)}</strong><small>Need fitment rows</small>
          </button>
          <button type="button" onClick={() => { setFilter("approved"); setPage(1); }}>
            <span>Approved</span><strong>{formatCount(stats.approved)}</strong><small>Ready for export</small>
          </button>
        </section>

        <section className="catalog-panel">
          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">Search listings</span>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search title, brand, part number, SKU…"
              />
              {queryInput && <button type="button" onClick={() => setQueryInput("")} aria-label="Clear search">×</button>}
            </label>
            <div className="result-count">{resultLabel}</div>
          </div>

          <div className="filter-row" aria-label="Listing filters">
            {FILTERS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => { setFilter(value); setPage(1); }}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="empty-state error-state"><strong>Catalogue unavailable</strong><p>{error}</p></div>
          ) : loading && !data ? (
            <div className="loading-grid" aria-label="Loading listings">
              {Array.from({ length: 8 }).map((_, index) => <div className="skeleton-card" key={index} />)}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="empty-state"><strong>No listings match this view</strong><p>Try another filter or search term.</p></div>
          ) : (
            <div className={`listing-grid ${loading ? "is-refreshing" : ""}`}>
              {data?.items.map((item) => {
                const badge = readinessLabel(item);
                return (
                  <button className="listing-card" type="button" key={item.listingId} onClick={() => setSelectedId(item.listingId)}>
                    <div className="card-image"><ImageThumb src={item.primaryImageUrl} alt={item.title} /></div>
                    <div className="card-body">
                      <div className="card-topline">
                        <span className={`status-pill ${badge.tone}`}>{badge.text}</span>
                        <span className="source-code">{item.brand || "Unbranded"}</span>
                      </div>
                      <h2>{item.title}</h2>
                      <p className="part-number">MPN {item.manufacturerPartNumber || "Not provided"}</p>
                      <div className="card-footer">
                        <span>{item.productType || item.category || "Uncategorized"}</span>
                        <span>{item.compatibilityCount} fitments</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {data && data.pageCount > 1 && (
            <nav className="pagination" aria-label="Catalogue pages">
              <button type="button" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button>
              <span>Page <strong>{data.page}</strong> of {formatCount(data.pageCount)}</span>
              <button type="button" disabled={data.page >= data.pageCount} onClick={() => setPage((value) => value + 1)}>Next →</button>
            </nav>
          )}
        </section>
          </>
        )}
      </div>

      {selectedId && (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Edit listing">
          <button className="drawer-backdrop" type="button" onClick={() => setSelectedId(null)} aria-label="Close editor" />
          <aside className="drawer">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Listing review</p>
                <h2>{detail?.brand || "Superior Auto Parts"}</h2>
                <p>{detail?.manufacturerPartNumber || selectedId}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelectedId(null)} aria-label="Close editor">×</button>
            </div>

            {detailLoading || !detail ? (
              <div className="drawer-loading"><div className="spinner" /><p>Loading the listing…</p></div>
            ) : (
              <div className="drawer-content">
                <section className="review-checks" aria-label="Completion checks">
                  <span className={detail.readiness.title ? "done" : ""}>Title</span>
                  <span className={detail.readiness.image ? "done" : ""}>Image</span>
                  <span className={detail.readiness.compatibility ? "done" : ""}>Compatibility</span>
                </section>

                <section className="edit-section">
                  <div className="section-heading"><div><span>01</span><h3>SEO product title</h3></div><small>{detail.title.length}/{SEO_TITLE_MAX_LENGTH} characters</small></div>
                  <div className="title-template"><strong>Required format</strong><span>{SEO_TITLE_TEMPLATE}</span></div>
                  <label className="field-label" htmlFor="listing-oe-number">Verified OE number</label>
                  <div className="oe-lookup-row">
                    <input
                      className="title-reference-input"
                      id="listing-oe-number"
                      value={detail.oemPartNumber}
                      placeholder="Enter the genuine OE cross-reference"
                      onChange={(event) => {
                        updateDetail({ oemPartNumber: event.target.value });
                        setOeLookupState("idle");
                        setOeLookupMessage("");
                      }}
                    />
                    <button
                      type="button"
                      disabled={
                        oeLookupState === "loading" ||
                        (detail.oemPartNumber.trim().length < 5 &&
                          (!(detail.brand || detail.manufacturer).trim() || detail.manufacturerPartNumber.trim().length < 5))
                      }
                      onClick={() => void lookupCompatibility()}
                    >
                      {oeLookupState === "loading"
                        ? "Looking up…"
                        : detail.oemPartNumber.trim().length >= 5
                          ? "Find by OE"
                          : "Find by Brand + MPN"}
                    </button>
                  </div>
                  <p className="field-help">If OE is unavailable, the exact listing brand and MPN are checked against confirmed catalogue evidence.</p>
                  {oeLookupMessage && <p className={`oe-lookup-message ${oeLookupState}`}>{oeLookupMessage}</p>}
                  <div className="title-field-heading">
                    <label className="field-label" htmlFor="listing-title">Complete enriched title</label>
                    <button type="button" onClick={() => updateDetail({ title: buildSeoTitle(detail) })}>Build from verified data</button>
                  </div>
                  <textarea
                    id="listing-title"
                    rows={3}
                    value={detail.title}
                    aria-describedby="title-requirements"
                    onChange={(event) => updateDetail({ title: event.target.value })}
                  />
                  <div className="title-requirements" id="title-requirements">
                    {TITLE_CHECKS.map(([key, label]) => (
                      <span className={detail.readiness.titleChecks[key] ? "done" : ""} key={key}>{label}</span>
                    ))}
                  </div>
                  <div className="source-comparison">
                    <div><span>Original</span><p>{detail.originalTitle}</p></div>
                    {detail.suggestedTitle && detail.suggestedTitle !== detail.title && (
                      <button type="button" onClick={() => updateDetail({ title: detail.suggestedTitle })}>Use previous suggestion</button>
                    )}
                  </div>
                </section>

                <section className="edit-section">
                  <div className="section-heading"><div><span>02</span><h3>Product images</h3></div><small>{detail.imageUrls.length} selected</small></div>
                  <div className="selected-images">
                    {detail.imageUrls.map((url, index) => (
                      <div className="selected-image" key={`${url}-${index}`}>
                        <ImageThumb src={url} alt={`${detail.title} image ${index + 1}`} />
                        <div><strong>{index === 0 ? "Primary image" : `Image ${index + 1}`}</strong><p>{url}</p></div>
                        <button type="button" onClick={() => updateDetail({ imageUrls: detail.imageUrls.filter((_, current) => current !== index) })} aria-label={`Remove image ${index + 1}`}>Remove</button>
                      </div>
                    ))}
                    {detail.imageUrls.length === 0 && <div className="inline-empty">No confirmed image yet.</div>}
                  </div>
                  <div className="inline-add">
                    <input type="url" placeholder="Paste a confirmed image URL" value={newImageUrl} onChange={(event) => setNewImageUrl(event.target.value)} />
                    <button type="button" onClick={() => { if (/^https?:\/\//i.test(newImageUrl.trim())) { updateDetail({ imageUrls: [...detail.imageUrls, newImageUrl.trim()] }); setNewImageUrl(""); } }}>Add image</button>
                  </div>
                  {detail.candidateImages.length > 0 && (
                    <div className="candidate-box">
                      <div><strong>Available image candidate</strong><p>{detail.candidateImages[0]!.confidence || "Unscored"} confidence · {detail.candidateImages[0]!.validation || detail.candidateImages[0]!.status}</p></div>
                      <button type="button" onClick={() => updateDetail({ imageUrls: [...new Set([...detail.imageUrls, detail.candidateImages[0]!.url])] })}>Use candidate</button>
                    </div>
                  )}
                </section>

                <section className="edit-section">
                  <div className="section-heading"><div><span>03</span><h3>Vehicle compatibility</h3></div><small>{detail.compatibility.length} rows</small></div>
                  <label className="universal-toggle">
                    <input type="checkbox" checked={detail.universalFitment} onChange={(event) => updateDetail({ universalFitment: event.target.checked })} />
                    <span><strong>This is a universal-fit part</strong><small>Use only when vehicle-specific fitment does not apply.</small></span>
                  </label>
                  {!detail.universalFitment && (
                    <div className="fitment-list">
                      {detail.compatibility.map((row, index) => (
                        <div className="fitment-row" key={row.id}>
                          <div className="fitment-row-head"><strong>Compatibility {index + 1}</strong><button type="button" onClick={() => updateDetail({ compatibility: detail.compatibility.filter((item) => item.id !== row.id) })}>Remove</button></div>
                          <div className="fitment-fields">
                            <label><span>From year</span><input inputMode="numeric" value={row.yearStart} onChange={(event) => updateCompatibility(row.id, { yearStart: event.target.value })} /></label>
                            <label><span>To year</span><input inputMode="numeric" value={row.yearEnd} onChange={(event) => updateCompatibility(row.id, { yearEnd: event.target.value })} /></label>
                            <label><span>Make</span><input value={row.make} onChange={(event) => updateCompatibility(row.id, { make: event.target.value })} /></label>
                            <label><span>Model</span><input value={row.model} onChange={(event) => updateCompatibility(row.id, { model: event.target.value })} /></label>
                            <label><span>Trim</span><input value={row.trim} onChange={(event) => updateCompatibility(row.id, { trim: event.target.value })} /></label>
                            <label><span>Engine</span><input value={row.engine} onChange={(event) => updateCompatibility(row.id, { engine: event.target.value })} /></label>
                            <label className="full"><span>Fitment notes or exclusions</span><input value={row.notes} onChange={(event) => updateCompatibility(row.id, { notes: event.target.value })} /></label>
                          </div>
                        </div>
                      ))}
                      <button className="add-fitment" type="button" onClick={() => updateDetail({ compatibility: [...detail.compatibility, newCompatibilityRow()] })}>+ Add compatibility row</button>
                    </div>
                  )}
                </section>

                <section className="edit-section compact">
                  <label className="field-label" htmlFor="reviewer-note">Internal review note</label>
                  <textarea id="reviewer-note" rows={2} placeholder="Record source checks, uncertainty, or follow-up work…" value={detail.reviewerNote} onChange={(event) => updateDetail({ reviewerNote: event.target.value })} />
                </section>
              </div>
            )}

            {detail && !detailLoading && (
              <div className="drawer-footer">
                <div className={`save-message ${saveState}`} aria-live="polite">{saveMessage || (detail.status === "approved" ? "This listing is approved." : "Changes are stored only on this computer.")}</div>
                <div className="footer-actions">
                  <button className="button secondary" type="button" disabled={saveState === "saving"} onClick={() => void save("draft")}>Save draft</button>
                  <button className="button primary" type="button" disabled={saveState === "saving"} onClick={() => void save("approved")}>{saveState === "saving" ? "Saving…" : "Approve listing"}</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
