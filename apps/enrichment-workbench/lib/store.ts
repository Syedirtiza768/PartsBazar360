import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type {
  CompatibilityRow,
  HighConfidenceFitment,
  ListingDetail,
  ListingEdit,
  ListingReadiness,
  ListingStats,
  ListingSummary,
  ReviewStatus,
  SourceListing,
} from "./types";
import { assessSeoTitle } from "./title-quality";

function findRepoRoot(start: string) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      existsSync(path.join(current, "turbo.json")) &&
      existsSync(path.join(current, "apps", "enrichment-workbench"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Unable to locate the PartsBazar360 workspace root.");
}

const REPO_ROOT = findRepoRoot(process.cwd());
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const INDEX_PATH = path.join(WORK_DIR, "catalog.jsonl");
const META_PATH = path.join(WORK_DIR, "catalog-meta.json");
const EDITS_PATH = path.join(WORK_DIR, "edits.json");
const COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "compatibility.jsonl");
const COMPATIBILITY_OFFSETS_PATH = path.join(WORK_DIR, "compatibility-offsets.json");
const OE_COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "oe-compatibility-index.json");
const MPN_COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "mpn-compatibility-index.json");
const LUNA_ENRICHMENT_PATH = path.join(WORK_DIR, "mpn-luna-enrichment.jsonl");

export interface CatalogMeta {
  generatedAt: string;
  sourceFile: string;
  totalListings: number;
  titleSuggestions: number;
  listingsWithImages: number;
  listingsWithCompatibility: number;
  oeCompatibilityLookups: number;
  mpnCompatibilityLookups: number;
  titlesWithOe: number;
  titlesWithConfirmedFitment: number;
  titlesUsingOeFallback: number;
  titlesUsingFitmentFallback: number;
  titlesMatchedByBrandMpn: number;
}

interface OeCompatibilityMatch {
  canonicalPartId: string;
  oeNumber: string;
  sourceTitle: string;
  fitmentStatus: string;
  confidence: number;
}

interface MpnCompatibilityMatch {
  canonicalPartId: string;
  brand: string;
  manufacturerPartNumber: string;
  oeNumber: string;
  sourceTitle: string;
  fitmentStatus: string;
  confidence: number;
  fitmentLabels: string[];
  fitmentCount: number;
}

interface StoreState {
  listings: SourceListing[];
  highConfidenceFitments: HighConfidenceFitment[];
  byId: Map<string, SourceListing>;
  edits: Record<string, ListingEdit>;
  meta: CatalogMeta;
  compatibilityOffsets: Record<string, { offset: number; length: number }>;
  oeCompatibilityIndex: Record<string, OeCompatibilityMatch>;
  mpnCompatibilityIndex: Record<string, MpnCompatibilityMatch>;
}

declare global {
  var superiorWorkbenchStore: Promise<StoreState> | undefined;
}

async function loadHighConfidenceFitments(): Promise<HighConfidenceFitment[]> {
  let raw: string;
  try {
    raw = await fs.readFile(LUNA_ENRICHMENT_PATH, "utf8");
  } catch {
    return [];
  }
  const byKey = new Map<string, HighConfidenceFitment>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<HighConfidenceFitment> & { status?: string };
      const identityConfidence = Number(row.identityConfidence || 0);
      const fitmentConfidence = Number(row.fitmentConfidence || 0);
      if (
        row.status !== "ok" ||
        !row.key ||
        !row.brand ||
        !row.mpn ||
        identityConfidence < 0.85 ||
        fitmentConfidence < 0.85 ||
        !Array.isArray(row.fitment) ||
        row.fitment.length === 0
      ) continue;
      byKey.set(row.key, {
        key: row.key,
        brand: row.brand,
        mpn: row.mpn,
        productDescription: row.productDescription || "Automotive part",
        identityConfidence,
        fitmentConfidence,
        oeNumbers: Array.isArray(row.oeNumbers) ? row.oeNumbers.map(String) : [],
        fitment: row.fitment as CompatibilityRow[],
        evidenceBasis: row.evidenceBasis || "",
        sourceUrls: Array.isArray(row.sourceUrls) ? row.sourceUrls.map(String) : [],
      });
    } catch {
      // Ignore a partial final line while the resumable enrichment runner is active.
    }
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}
async function loadStore(): Promise<StoreState> {
  let indexText: string;
  try {
    indexText = await fs.readFile(INDEX_PATH, "utf8");
  } catch {
    throw new Error(
      `The local catalogue index is missing at ${INDEX_PATH}. Run \`npm run prepare-data --workspace enrichment-workbench\` first.`,
    );
  }

  const listings = indexText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SourceListing);
  const byId = new Map(listings.map((listing) => [listing.listingId, listing]));
  const meta = JSON.parse(await fs.readFile(META_PATH, "utf8")) as CatalogMeta;
  const compatibilityOffsets = JSON.parse(
    await fs.readFile(COMPATIBILITY_OFFSETS_PATH, "utf8"),
  ) as Record<string, { offset: number; length: number }>;
  let edits: Record<string, ListingEdit> = {};
  const oeCompatibilityIndex = JSON.parse(
    await fs.readFile(OE_COMPATIBILITY_INDEX_PATH, "utf8"),
  ) as Record<string, OeCompatibilityMatch>;
  const mpnCompatibilityIndex = JSON.parse(
    await fs.readFile(MPN_COMPATIBILITY_INDEX_PATH, "utf8"),
  ) as Record<string, MpnCompatibilityMatch>;
  try {
    edits = JSON.parse(await fs.readFile(EDITS_PATH, "utf8")) as Record<string, ListingEdit>;
  } catch {
    // A new local workspace intentionally starts with no edits.
  }
  const highConfidenceFitments = await loadHighConfidenceFitments();
  return { listings, byId, edits, meta, compatibilityOffsets, oeCompatibilityIndex, mpnCompatibilityIndex, highConfidenceFitments };
}

async function loadCompatibility(state: StoreState, canonicalPartId: string) {
  const location = state.compatibilityOffsets[canonicalPartId];
  if (!location) return [];
  const handle = await fs.open(COMPATIBILITY_INDEX_PATH, "r");
  try {
    const buffer = Buffer.alloc(location.length);
    await handle.read(buffer, 0, location.length, location.offset);
    const parsed = JSON.parse(buffer.toString("utf8")) as { compatibility: CompatibilityRow[] };
    return parsed.compatibility || [];
  } finally {
    await handle.close();
  }
}

function getStore() {
  globalThis.superiorWorkbenchStore ??= loadStore();
  return globalThis.superiorWorkbenchStore;
}

function effectiveDetail(source: SourceListing, edit?: ListingEdit): ListingDetail {
  const title = edit?.title?.trim() || source.suggestedTitle || source.originalTitle;
  const imageUrls = edit?.imageUrls ?? source.currentImageUrls;
  const compatibility = edit?.compatibility ?? source.existingCompatibility;
  const oemPartNumber = edit?.oemPartNumber?.trim() || source.oemPartNumber;
  const compatibilityCount = edit?.compatibility?.length ?? source.existingCompatibilityCount;
  const universalFitment = edit?.universalFitment ?? false;
  const readiness = assessReadiness(
    { ...source, oemPartNumber },
    title,
    imageUrls,
    compatibility,
    universalFitment,
    !edit && source.existingCompatibilityReady,
  );
  return {
    ...source,
    title,
    imageUrls,
    compatibility,
    compatibilityCount,
    oemPartNumber,
    universalFitment,
    reviewerNote: edit?.reviewerNote || "",
    status: edit?.status || "unreviewed",
    editUpdatedAt: edit?.updatedAt || "",
    readiness,
  };
}

function assessReadiness(
  source: SourceListing,
  title: string,
  imageUrls: string[],
  compatibility: CompatibilityRow[],
  universalFitment: boolean,
  sourceCompatibilityReady = false,
): ListingReadiness {
  const normalized = title.trim().toLowerCase();
  const genericPattern = new RegExp(
    `^${escapeRegExp(source.brand.trim().toLowerCase())}\\s+(auto\\s+)?part\\s*[-–—:]?\\s*${escapeRegExp(source.manufacturerPartNumber.trim().toLowerCase())}(?:\\s*[-–—|:].*)?$`,
  );
  const titleChecks = assessSeoTitle({
    ...source,
    title,
    compatibility,
    universalFitment,
    sourceCompatibilityReady,
  });
  const titleOk = titleChecks.complete && !genericPattern.test(normalized);
  const imageOk = imageUrls.some((url) => /^https?:\/\//i.test(url.trim()));
  const compatibilityOk =
    universalFitment || sourceCompatibilityReady ||
    compatibility.some(
      (row) => row.make.trim().length > 0 && row.model.trim().length > 0 && row.yearStart.trim().length > 0,
    );
  return {
    title: titleOk,
    titleChecks,
    image: imageOk,
    compatibility: compatibilityOk,
    ready: titleOk && imageOk && compatibilityOk,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSummary(detail: ListingDetail): ListingSummary {
  return {
    listingId: detail.listingId,
    title: detail.title,
    originalTitle: detail.originalTitle,
    brand: detail.brand,
    manufacturerPartNumber: detail.manufacturerPartNumber,
    category: detail.category,
    productType: detail.productType,
    price: detail.price,
    currency: detail.currency,
    primaryImageUrl: detail.imageUrls[0] || detail.candidateImages[0]?.url || "",
    compatibilityCount: detail.compatibilityCount,
    status: detail.status,
    readiness: detail.readiness,
  };
}

function matchesFilter(detail: ListingDetail, filter: string) {
  switch (filter) {
    case "needs-title":
      return !detail.readiness.title;
    case "needs-image":
      return !detail.readiness.image;
    case "needs-compatibility":
      return !detail.readiness.compatibility;
    case "ready":
      return detail.readiness.ready && detail.status !== "approved";
    case "approved":
    case "draft":
    case "unreviewed":
      return detail.status === filter;
    default:
      return true;
  }
}

function statsFor(state: StoreState): ListingStats {
  const stats: ListingStats = {
    total: state.listings.length,
    unreviewed: 0,
    draft: 0,
    approved: 0,
    ready: 0,
    needsTitle: 0,
    needsImage: 0,
    needsCompatibility: 0,
  };
  for (const source of state.listings) {
    const detail = effectiveDetail(source, state.edits[source.listingId]);
    stats[detail.status] += 1;
    if (detail.readiness.ready) stats.ready += 1;
    if (!detail.readiness.title) stats.needsTitle += 1;
    if (!detail.readiness.image) stats.needsImage += 1;
    if (!detail.readiness.compatibility) stats.needsCompatibility += 1;
  }
  return stats;
}

export async function listListings(options: {
  query?: string;
  filter?: string;
  page?: number;
  pageSize?: number;
}) {
  const state = await getStore();
  const query = options.query?.trim().toLowerCase() || "";
  const filter = options.filter || "all";
  const pageSize = Math.min(Math.max(options.pageSize || 24, 1), 100);
  const page = Math.max(options.page || 1, 1);
  const filtered: ListingSummary[] = [];

  for (const source of state.listings) {
    if (
      query &&
      ![
        source.originalTitle,
        source.suggestedTitle,
        source.brand,
        source.manufacturer,
        source.manufacturerPartNumber,
        source.oemPartNumber,
        source.sellerSku,
        source.category,
      ].some((value) => value.toLowerCase().includes(query))
    ) {
      continue;
    }
    const detail = effectiveDetail(source, state.edits[source.listingId]);
    if (matchesFilter(detail, filter)) filtered.push(toSummary(detail));
  }

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
    stats: statsFor(state),
    source: state.meta,
  };
}

export async function listHighConfidenceFitments(options: {
  query?: string;
  page?: number;
  pageSize?: number;
}) {
  const state = await getStore();
  const query = options.query?.trim().toLowerCase() || "";
  const pageSize = Math.min(Math.max(options.pageSize || 24, 1), 100);
  const page = Math.max(options.page || 1, 1);
  const filtered = state.highConfidenceFitments.filter((item) => {
    if (!query) return true;
    const searchable = [
      item.key,
      item.brand,
      item.mpn,
      item.productDescription,
      item.oeNumbers.join(" "),
      item.fitment.map((row) => [row.make, row.model, row.trim, row.engine].join(" ")).join(" "),
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
    summary: {
      totalResults: state.highConfidenceFitments.length,
      fitmentRows: state.highConfidenceFitments.reduce((sum, item) => sum + item.fitment.length, 0),
    },
  };
}
export async function getListing(id: string) {
  const state = await getStore();
  const source = state.byId.get(id);
  if (!source) return null;
  const existingCompatibility = state.edits[id]
    ? source.existingCompatibility
    : await loadCompatibility(
        state,
        source.compatibilitySourceCanonicalPartId || source.canonicalPartId,
      );
  return effectiveDetail({ ...source, existingCompatibility }, state.edits[id]);
}

function normalizeOeNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeBrand(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function lookupCompatibilityByOe(value: string) {
  const state = await getStore();
  const normalized = normalizeOeNumber(value);
  if (normalized.length < 5) return null;
  const match = state.oeCompatibilityIndex[normalized];
  if (!match) return null;
  const compatibility = await loadCompatibility(state, match.canonicalPartId);
  if (compatibility.length === 0) return null;
  return {
    query: value.trim(),
    matchedOeNumber: match.oeNumber,
    sourceCanonicalPartId: match.canonicalPartId,
    sourceTitle: match.sourceTitle,
    fitmentStatus: match.fitmentStatus,
    confidence: match.confidence,
    compatibility,
  };
}

export async function lookupCompatibilityByMpn(brandValue: string, mpnValue: string) {
  const state = await getStore();
  const normalizedBrand = normalizeBrand(brandValue);
  const normalizedMpn = normalizeOeNumber(mpnValue);
  if (!normalizedBrand || normalizedMpn.length < 5) return null;
  const match = state.mpnCompatibilityIndex[`${normalizedBrand}|${normalizedMpn}`];
  if (!match) return null;
  const compatibility = await loadCompatibility(state, match.canonicalPartId);
  if (compatibility.length === 0) return null;
  return {
    query: { brand: brandValue.trim(), manufacturerPartNumber: mpnValue.trim() },
    matchedBy: "BRAND_MPN" as const,
    matchedBrand: match.brand,
    matchedManufacturerPartNumber: match.manufacturerPartNumber,
    matchedOeNumber: match.oeNumber,
    sourceCanonicalPartId: match.canonicalPartId,
    sourceTitle: match.sourceTitle,
    fitmentStatus: match.fitmentStatus,
    confidence: match.confidence,
    compatibility,
  };
}

let editWriteQueue = Promise.resolve();

export async function saveListing(
  id: string,
  input: {
    title: string;
    oemPartNumber: string;
    imageUrls: string[];
    compatibility: CompatibilityRow[];
    universalFitment: boolean;
    reviewerNote: string;
    status: ReviewStatus;
  },
) {
  const state = await getStore();
  const source = state.byId.get(id);
  if (!source) return { ok: false as const, status: 404, error: "Listing not found" };

  const cleanTitle = input.title.trim();
  const cleanOemPartNumber = input.oemPartNumber.trim();
  const cleanImages = [...new Set(input.imageUrls.map((url) => url.trim()).filter(Boolean))];
  const cleanCompatibility = input.compatibility.map((row, index) => ({
    id: row.id || `fitment-${Date.now()}-${index}`,
    yearStart: row.yearStart.trim(),
    yearEnd: row.yearEnd.trim(),
    make: row.make.trim(),
    model: row.model.trim(),
    trim: row.trim.trim(),
    engine: row.engine.trim(),
    notes: row.notes.trim(),
  }));
  const readiness = assessReadiness(
    { ...source, oemPartNumber: cleanOemPartNumber },
    cleanTitle,
    cleanImages,
    cleanCompatibility,
    input.universalFitment,
  );
  if (input.status === "approved" && !readiness.ready) {
    return {
      ok: false as const,
      status: 422,
      error: "Complete the title, image, and compatibility checks before approving this listing.",
      readiness,
    };
  }

  const edit: ListingEdit = {
    title: cleanTitle,
    imageUrls: cleanImages,
    compatibility: cleanCompatibility,
    universalFitment: Boolean(input.universalFitment),
    reviewerNote: input.reviewerNote.trim(),
    status: input.status,
    updatedAt: new Date().toISOString(),
    oemPartNumber: cleanOemPartNumber,
  };
  state.edits[id] = edit;

  editWriteQueue = editWriteQueue.then(async () => {
    await fs.mkdir(WORK_DIR, { recursive: true });
    const temporaryPath = `${EDITS_PATH}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state.edits, null, 2), "utf8");
    await fs.rename(temporaryPath, EDITS_PATH);
  });
  await editWriteQueue;
  return { ok: true as const, listing: effectiveDetail(source, edit) };
}

export async function exportApproved() {
  const state = await getStore();
  return state.listings
    .map((source) => effectiveDetail(source, state.edits[source.listingId]))
    .filter((detail) => detail.status === "approved" && detail.readiness.ready);
}
