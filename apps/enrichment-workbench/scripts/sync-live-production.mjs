/* eslint-disable turbo/no-undeclared-env-vars */
/* global process */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const SNAPSHOT_PATH = path.join(WORK_DIR, "live-production-listings.csv");
const META_PATH = path.join(WORK_DIR, "live-production-sync.json");

const API_URL = (process.env.LIVE_API_URL || "https://partsbazar360.com/api/search/parts").replace(/\/+$/, "");
const TAGS = (process.env.LIVE_SOURCE_TAGS || "AAP,BST,YNTD,TNRU,PSRC,GEN")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const PAGE_SIZE = Math.min(200, Math.max(25, Number(process.env.LIVE_PAGE_SIZE || 200)));
const CONCURRENCY = Math.min(16, Math.max(1, Number(process.env.LIVE_SYNC_CONCURRENCY || 8)));
const REQUEST_TIMEOUT_MS = Math.min(120000, Math.max(10000, Number(process.env.LIVE_REQUEST_TIMEOUT_MS || 60000)));
const MAX_RETRIES = 4;
const SUPERIOR_SELLER_ID = "seller-superior-auto-parts";
const SUPERIOR_SELLER_NAME = /superior\s+auto\s+parts/i;

function text(value) {
  return String(value ?? "").trim();
}

function csvEscape(value) {
  const raw = text(value);
  return /[",\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw;
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function sourceRow(item, offer, tag, syncedAt) {
  const itemSourceTags = Array.isArray(item.sourceTags) ? item.sourceTags.map((v) => text(v).toUpperCase()) : [];
  const offerTag = text(offer.sourceTag || tag).toUpperCase();
  if (!offerTag || !itemSourceTags.includes(offerTag)) return null;
  const sellerName = text(offer.sellerName || offer.seller?.name);
  const sellerId = text(offer.sellerId);
  if (sellerId !== SUPERIOR_SELLER_ID && !SUPERIOR_SELLER_NAME.test(sellerName)) return null;

  const partSource = text(offer.partSource || item.partSource);
  const partType = text(offer.partType || item.partType);
  const qualityTier = text(offer.qualityTier || item.qualityTier);
  const oemCandidate = partSource.toUpperCase() === "OEM" || partType.toUpperCase() === "GENUINE_OEM"
    ? (Array.isArray(item.oeNumbers) ? item.oeNumbers.map(text).find(Boolean) : "")
    : "";
  const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls.map(text).filter((v) => /^https?:\/\//i.test(v)) : [];
  const mpn = text(item.manufacturerPartNumber);
  return {
    listing_id: text(offer.id),
    canonical_part_id: text(item.id),
    seller_name: sellerName || "Superior Auto Parts",
    title: text(item.title),
    brand: text(item.brand),
    manufacturer: text(item.brand),
    mfr_part_number: mpn,
    oem_part_number: oemCandidate,
    category: text(item.category),
    part_type: partType,
    condition: text(offer.condition || qualityTier),
    part_source: partSource,
    quality_tier: qualityTier,
    price: numeric(offer.price),
    currency: text(offer.currency),
    status: "ACTIVE",
    source_tag: offerTag,
    moq: "1",
    warranty: "",
    return_policy: "",
    delivery_method: "",
    lead_time_days: "",
    seller_sku: mpn,
    created_at: text(item.createdAt),
    updated_at: syncedAt,
    current_image_urls: imageUrls.join("|"),
  };
}

async function requestJson(url, context) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "PartsBazar360-enrichment-workbench-live-sync/1.0" },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(context + ": HTTP " + response.status + " " + body.slice(0, 240));
      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(15000, 500 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(context + ": request failed");
}

async function getTotal(tag) {
  const params = new URLSearchParams({ sourceTag: tag, countOnly: "true" });
  const payload = await requestJson(API_URL + "?" + params, "count " + tag);
  const total = Number(payload.total);
  if (!Number.isFinite(total) || total < 0) throw new Error("count " + tag + ": invalid total");
  return total;
}

async function getPage(tag, page) {
  const params = new URLSearchParams({
    sourceTag: tag,
    page: String(page),
    limit: String(PAGE_SIZE),
    sort: "newest",
    includeInterchange: "false",
  });
  return requestJson(API_URL + "?" + params, tag + " page " + page);
}

async function mapConcurrent(values, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, () => run()));
  return output;
}

async function fetchTag(tag) {
  const total = await getTotal(tag);
  const pages = Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, index) => index + 1);
  process.stdout.write(tag + ": " + total.toLocaleString() + " live parts across " + pages.length + " pages\n");
  const payloads = await mapConcurrent(pages, (page) => getPage(tag, page));
  const rows = [];
  const itemIds = new Set();
  for (const payload of payloads) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      if (item?.id) itemIds.add(String(item.id));
      const offers = Array.isArray(item?.offers) ? item.offers : [];
      for (const offer of offers) {
        const row = sourceRow(item, offer, tag, new Date().toISOString());
        if (row) rows.push(row);
      }
    }
  }
  return { tag, reportedTotal: total, fetchedItems: itemIds.size, rows };
}

function parseCsvRecords(raw) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let pendingQuote = false;
  const emitField = () => { record.push(field); field = ''; };
  const emitRecord = () => {
    if (record.length || field.length) {
      emitField();
      records.push(record);
      record = [];
    }
  };
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (pendingQuote) {
      if (character === '"') {
        field += '"';
        pendingQuote = false;
        continue;
      }
      quoted = false;
      pendingQuote = false;
    }
    if (quoted) {
      if (character === '"') pendingQuote = true;
      else field += character;
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      emitField();
    } else if (character === '\n') {
      emitRecord();
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (pendingQuote) quoted = false;
  emitRecord();
  return records;
}

async function readExistingIds() {
  const staticPath = path.join(REPO_ROOT, 'active_listings_superior_auto_parts_active_from_server.csv');
  if (!existsSync(staticPath)) return new Set();
  const records = parseCsvRecords(await readFile(staticPath, 'utf8'));
  if (records.length === 0) return new Set();
  const idIndex = records[0].indexOf('listing_id');
  if (idIndex < 0) return new Set();
  return new Set(records.slice(1).map((record) => text(record[idIndex])).filter(Boolean));
}
async function main() {
  const startedAt = new Date().toISOString();
  await mkdir(WORK_DIR, { recursive: true });
  const results = await mapConcurrent(TAGS, (tag) => fetchTag(tag));
  const rows = results.flatMap((result) => result.rows);
  const deduped = new Map();
  for (const row of rows) {
    if (!deduped.has(row.listing_id)) deduped.set(row.listing_id, row);
  }
  const finalRows = [...deduped.values()].sort((a, b) => {
    const tagOrder = TAGS.indexOf(a.source_tag) - TAGS.indexOf(b.source_tag);
    return tagOrder || a.listing_id.localeCompare(b.listing_id);
  });
  const header = [
    "listing_id", "canonical_part_id", "seller_name", "title", "brand", "manufacturer",
    "mfr_part_number", "oem_part_number", "category", "part_type", "condition", "part_source",
    "quality_tier", "price", "currency", "status", "source_tag", "moq", "warranty",
    "return_policy", "delivery_method", "lead_time_days", "seller_sku", "created_at",
    "updated_at", "current_image_urls",
  ];
  const csv = [
    header.join(","),
    ...finalRows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
  const temporaryPath = SNAPSHOT_PATH + ".tmp";
  await writeFile(temporaryPath, csv, "utf8");
  await rename(temporaryPath, SNAPSHOT_PATH);

  const previousIds = await readExistingIds();
  const liveIds = new Set(finalRows.map((row) => row.listing_id));
  const added = [...liveIds].filter((id) => !previousIds.has(id)).length;
  const removed = [...previousIds].filter((id) => !liveIds.has(id)).length;
  const counts = Object.fromEntries(TAGS.map((tag) => [tag, finalRows.filter((row) => row.source_tag === tag).length]));
  const meta = {
    startedAt,
    completedAt: new Date().toISOString(),
    apiUrl: API_URL,
    sourceTags: TAGS,
    pageSize: PAGE_SIZE,
    concurrency: CONCURRENCY,
    reportedTotals: Object.fromEntries(results.map((result) => [result.tag, result.reportedTotal])),
    fetchedCanonicalParts: Object.fromEntries(results.map((result) => [result.tag, result.fetchedItems])),
    liveRows: finalRows.length,
    liveRowsBySourceTag: counts,
    previousSnapshotRows: previousIds.size,
    addedRows: added,
    removedRows: removed,
    deduplicatedRows: rows.length - finalRows.length,
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write("Live snapshot ready: " + finalRows.length.toLocaleString() + " rows (added " + added.toLocaleString() + ", removed " + removed.toLocaleString() + ")\n");
  process.stdout.write("Metadata: " + META_PATH + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : error) + "\n");
  process.exitCode = 1;
});

