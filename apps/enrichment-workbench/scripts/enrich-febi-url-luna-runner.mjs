/* eslint-disable turbo/no-undeclared-env-vars, no-undef */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const CATALOG_PATH = path.join(WORK_DIR, "catalog.jsonl");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env["LUNA_MODEL"] || process.env["OFFICIAL_MODEL"] || "openai/gpt-5.6-luna";
const LIMIT = Math.max(1, Number(process.env["FEBI_URL_LUNA_LIMIT"] || 500));
const OFFSET = Math.max(0, Number(process.env["FEBI_URL_LUNA_OFFSET"] || 0));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env["FEBI_URL_LUNA_CONCURRENCY"] || 8), 24));
const MAX_RETRIES = Math.max(1, Math.min(Number(process.env["FEBI_URL_LUNA_RETRIES"] || 4), 8));
const DELAY_MS = Math.max(0, Number(process.env["FEBI_URL_LUNA_DELAY_MS"] || 150));
const BUDGET_USD = Math.max(0, Number(process.env["FEBI_URL_LUNA_BUDGET_USD"] || 15));
const BATCH_NAME = process.env["FEBI_URL_LUNA_BATCH"] || "001";
const OUTPUT_PATH = path.join(WORK_DIR, "febi-url-luna-enrichment-batch-" + BATCH_NAME + ".jsonl");
const MANIFEST_PATH = path.join(WORK_DIR, "febi-url-luna-batch-" + BATCH_NAME + ".json");
const META_PATH = path.join(WORK_DIR, "febi-url-luna-batch-" + BATCH_NAME + "-meta.json");

function loadEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return text(value).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parsePrice(value) {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function routeMpn(value) {
  const compact = text(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^\d+$/.test(compact) && compact.length < 5 ? compact.padStart(5, "0") : compact;
}

function sourceUrl(mpn) {
  return "https://partsfinder.bilsteingroup.com/en/article/febi/" + routeMpn(mpn);
}

function parseJson(content) {
  const raw = Array.isArray(content)
    ? content.map((block) => block?.text || "").join("")
    : String(content || "");
  const cleaned = raw.replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Luna returned no JSON object");
  return JSON.parse(match[0]);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function cleanAttributes(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => {
      if (typeof item === "string") return { name: item, value: "" };
      return { name: text(item?.name || item?.label), value: text(item?.value || item?.text) };
    })
    .filter((item) => item.name || item.value);
}

function cleanReferences(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      make: text(item?.make || item?.brand || item?.suitableToReplace),
      numbers: uniqueStrings(item?.numbers || item?.references || item?.referenceNumbers),
    }))
    .filter((item) => item.make || item.numbers.length > 0);
}

function cleanCompatibility(values) {
  return (Array.isArray(values) ? values : [])
    .map((item, index) => ({
      id: "febi-url-luna-" + (index + 1),
      yearStart: text(item?.yearStart || item?.startYear || item?.year),
      yearEnd: text(item?.yearEnd || item?.endYear || item?.year),
      make: text(item?.make || item?.vehicleMake || item?.manufacturer),
      model: text(item?.model || item?.vehicleModel),
      trim: text(item?.submodel || item?.variant || item?.trim),
      engine: text(item?.engine || item?.engineSpecification || item?.power),
      notes: text(item?.notes || item?.fittingPosition || item?.limitations),
      rawModel: text(item?.rawModel || item?.modelDisplay),
      rawSubmodel: text(item?.rawSubmodel || item?.submodelDisplay),
    }))
    .filter((item) => item.make || item.model || item.trim || item.engine || item.notes);
}

function cleanLinks(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => {
      if (typeof item === "string") return { title: "", url: text(item) };
      return { title: text(item?.title || item?.name), url: text(item?.url || item?.href) };
    })
    .filter((item) => item.url);
}

function cleanResult(raw, requested, usage) {
  const result = raw && typeof raw === "object" ? raw : {};
  const fitment = cleanCompatibility(result.compatibility || result.fitment || result.usedInVehicles);
  const references = cleanReferences(result.oeReferences || result.comparisonNumbers || result.references);
  const imageUrls = uniqueStrings(result.imageUrls || result.images);
  const documents = cleanLinks(result.documents || result.technicalDocuments);
  const videos = cleanLinks(result.videos);
  const relatedArticles = cleanLinks(result.relatedArticles || result.relatedProducts);
  const status = text(result.status || (result.pageStatus === "not_found" ? "not_found" : "ok")).toLowerCase();
  return {
    key: requested.key,
    brand: text(result.brand || "FEBI"),
    mpn: requested.mpn,
    routeMpn: requested.routeMpn,
    sourceUrl: requested.sourceUrl,
    status: status || "review",
    pageStatus: text(result.pageStatus || result.sourceStatus),
    articleNumber: text(result.articleNumber || result.mpn || requested.routeMpn),
    title: text(result.title || result.productDescription),
    description: text(result.description || result.productDescription),
    fittingPosition: text(result.fittingPosition),
    warranty: text(result.warranty),
    attributes: cleanAttributes(result.attributes),
    oeReferences: references,
    compatibility: fitment,
    fitmentStatus: fitment.length > 0 ? "confirmed_from_rendered_url" : text(result.fitmentStatus || "not_confirmed"),
    imageUrls,
    image360Url: text(result.image360Url || result.image360),
    documents,
    videos,
    relatedArticles,
    evidence: text(result.evidence || result.notes).slice(0, 1000),
    exactMatchConfidence: Number(result.exactMatchConfidence || result.identityConfidence || 0) || 0,
    model: MODEL,
    usage: usage || null,
  };
}

function buildPrompt(requested) {
  return "Use only the exact URL below as the source. You must call the openrouter:web_fetch tool for this URL and must not use web search, prior knowledge, another site, or a nearby/superseded part number.\n\n" +
    "URL: " + requested.sourceUrl + "\nBrand: FEBI\nRequested MPN: " + requested.mpn + "\n\n" +
    "Extract every available product field from the fetched page and return JSON only. Do not summarize or truncate vehicle applications. Preserve all visible Used In Vehicles rows, all image URLs shown in the page markup, all Comparison Number(s), all attributes, fitting position, warranty, technical documents, videos, and related article links.\n\n" +
    "Use this exact shape:\n" +
    "{\"status\":\"ok|not_found|review\",\"pageStatus\":\"\",\"brand\":\"\",\"articleNumber\":\"\",\"title\":\"\",\"description\":\"\",\"fittingPosition\":\"\",\"warranty\":\"\",\"attributes\":[{\"name\":\"\",\"value\":\"\"}],\"oeReferences\":[{\"make\":\"\",\"numbers\":[\"\"]}],\"compatibility\":[{\"make\":\"\",\"model\":\"\",\"yearStart\":\"\",\"yearEnd\":\"\",\"submodel\":\"\",\"engine\":\"\",\"notes\":\"\",\"rawModel\":\"\",\"rawSubmodel\":\"\"}],\"fitmentStatus\":\"confirmed|not_available_from_fetched_url|not_confirmed\",\"imageUrls\":[\"\"],\"image360Url\":\"\",\"documents\":[{\"title\":\"\",\"url\":\"\"}],\"videos\":[{\"title\":\"\",\"url\":\"\"}],\"relatedArticles\":[{\"title\":\"\",\"url\":\"\"}],\"evidence\":\"\",\"exactMatchConfidence\":0}\n\n" +
    "The Comparison Number(s) table is OE/reference data. The Used In Vehicles table is the vehicle fitment data. If the fetched URL returns only a PRODUCT_APPLICATIONS placeholder and no rendered rows, return an empty compatibility array and set fitmentStatus to not_available_from_fetched_url; never invent rows. Image URLs are text values—do not download or analyze the images. Return all rows and URLs present in the fetched content.";
}

async function callLuna(requested) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env["OPENROUTER_API_KEY"],
          "Content-Type": "application/json",
          "HTTP-Referer": "https://partsbazar360.com",
          "X-Title": "PartsBazar360 FEBI URL enrichment",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You are a strict automotive catalogue extractor. Use only the requested URL and return valid JSON." },
            { role: "user", content: buildPrompt(requested) },
          ],
          tools: [{
            type: "openrouter:web_fetch",
            parameters: {
              engine: "openrouter",
              max_uses: 1,
              max_content_tokens: 50000,
              allowed_domains: ["partsfinder.bilsteingroup.com"],
            },
          }],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 12000,
        }),
        signal: AbortSignal.timeout(180000),
      });
      const body = await response.text();
      if (!response.ok) throw new Error("OpenRouter " + response.status + ": " + body.slice(0, 500));
      const data = JSON.parse(body);
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
      const usage = data.usage || null;
      return { result: cleanResult(parseJson(content), requested, usage), usage };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 750 * 2 ** (attempt - 1))));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readCatalog() {
  const raw = await readFile(CATALOG_PATH, "utf8");
  const listings = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const febi = listings
    .filter((listing) => [listing.brand, listing.manufacturer, listing.titleBrand].some((value) => normalized(value) === "FEBI"))
    .map((listing, index) => ({
      listingId: text(listing.listingId),
      canonicalPartId: text(listing.canonicalPartId),
      brand: text(listing.brand || listing.manufacturer || "FEBI"),
      mpn: text(listing.manufacturerPartNumber || listing.sellerSku),
      price: parsePrice(listing.price),
      currency: text(listing.currency),
      originalTitle: text(listing.originalTitle),
      currentImageUrls: Array.isArray(listing.currentImageUrls) ? listing.currentImageUrls.map(text).filter(Boolean) : [],
      sourceUpdatedAt: text(listing.sourceUpdatedAt),
      _index: index,
    }))
    .filter((listing) => listing.mpn && routeMpn(listing.mpn));
  febi.sort((left, right) => right.price - left.price || left._index - right._index);
  const selectedListings = febi.slice(OFFSET, OFFSET + LIMIT);
  const byKey = new Map();
  for (const listing of selectedListings) {
    const key = "FEBI|" + normalized(listing.mpn);
    const existing = byKey.get(key);
    if (existing) {
      existing.listingIds.push(listing.listingId);
      existing.canonicalPartIds.push(listing.canonicalPartId);
      existing.prices.push(listing.price);
      existing.currentImageUrls.push(...listing.currentImageUrls);
      continue;
    }
    byKey.set(key, {
      key,
      brand: "FEBI",
      mpn: listing.mpn,
      routeMpn: routeMpn(listing.mpn),
      sourceUrl: sourceUrl(listing.mpn),
      listingIds: [listing.listingId],
      canonicalPartIds: [listing.canonicalPartId],
      prices: [listing.price],
      currency: listing.currency,
      originalTitles: [listing.originalTitle],
      currentImageUrls: [...listing.currentImageUrls],
      sourceUpdatedAt: listing.sourceUpdatedAt,
    });
  }
  const requests = [...byKey.values()].map((item) => ({ ...item, highestPrice: Math.max(...item.prices) }));
  requests.sort((left, right) => right.highestPrice - left.highestPrice || left.key.localeCompare(right.key));
  return { selectedListings, requests };
}

async function readCompleted() {
  const completed = new Set();
  if (!existsSync(OUTPUT_PATH)) return completed;
  const raw = await readFile(OUTPUT_PATH, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.key && row.status !== "error") completed.add(row.key);
    } catch {
      // Ignore a partial final line so the run can resume safely.
    }
  }
  return completed;
}

async function main() {
  loadEnvFile();
  if (!process.env["OPENROUTER_API_KEY"]) throw new Error("OPENROUTER_API_KEY is missing from " + ENV_PATH);
  await mkdir(WORK_DIR, { recursive: true });
  const data = await readCatalog();
  const selectedListings = data.selectedListings;
  const requests = data.requests;
  const completed = await readCompleted();
  const pending = requests.filter((request) => !completed.has(request.key));
  await writeFile(MANIFEST_PATH, JSON.stringify({
    batch: BATCH_NAME,
    model: MODEL,
    source: "live catalog sorted by price descending",
    offset: OFFSET,
    selectedListingCount: selectedListings.length,
    uniqueMpnCount: requests.length,
    duplicateListingCount: selectedListings.length - requests.length,
    selectedListings,
    requests,
  }, null, 2), "utf8");

  let spentUsd = 0;
  let processed = 0;
  let applied = 0;
  let fullFitment = 0;
  let failed = 0;
  let stoppedByBudget = false;
  let appendChain = Promise.resolve();
  const appendResult = async (row) => {
    appendChain = appendChain.then(() => appendFile(OUTPUT_PATH, JSON.stringify(row) + "\n", "utf8"));
    await appendChain;
  };
  let cursor = 0;
  const worker = async (workerId) => {
    while (true) {
      if (stoppedByBudget) return;
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const requested = pending[index];
      if (spentUsd >= BUDGET_USD) {
        stoppedByBudget = true;
        return;
      }
      try {
        const response = await callLuna(requested);
        const cost = Number(response.usage?.cost || 0);
        spentUsd += Number.isFinite(cost) ? cost : 0;
        processed += 1;
        if (response.result.status === "ok") applied += 1;
        if (response.result.compatibility.length > 0) fullFitment += 1;
        await appendResult({
          ...response.result,
          listingIds: requested.listingIds,
          canonicalPartIds: requested.canonicalPartIds,
          highestPrice: requested.highestPrice,
          currency: requested.currency,
          usage: response.usage,
        });
        process.stdout.write("[" + processed + "/" + pending.length + "] worker=" + workerId + " " + requested.mpn + " AED " + requested.highestPrice.toFixed(2) + " rows=" + response.result.compatibility.length + " images=" + response.result.imageUrls.length + " cost=$" + spentUsd.toFixed(4) + "\n");
      } catch (error) {
        failed += 1;
        await appendResult({
          key: requested.key,
          brand: requested.brand,
          mpn: requested.mpn,
          routeMpn: requested.routeMpn,
          sourceUrl: requested.sourceUrl,
          listingIds: requested.listingIds,
          canonicalPartIds: requested.canonicalPartIds,
          highestPrice: requested.highestPrice,
          currency: requested.currency,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          model: MODEL,
        });
        process.stdout.write("[error " + (processed + failed) + "/" + pending.length + "] worker=" + workerId + " " + requested.mpn + ": " + (error instanceof Error ? error.message : String(error)) + "\n");
      }
      if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, (_, index) => worker(index + 1)));
  const meta = {
    offset: OFFSET,
    batch: BATCH_NAME,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    selectedListingCount: selectedListings.length,
    uniqueMpnCount: requests.length,
    duplicateListingCount: selectedListings.length - requests.length,
    pendingAtStart: pending.length,
    processed,
    applied,
    fullFitment,
    failed,
    remaining: Math.max(0, pending.length - processed - failed),
    spentUsd,
    budgetUsd: BUDGET_USD,
    budgetStopped: stoppedByBudget,
    concurrency: CONCURRENCY,
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify(meta) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack || error.message : String(error)) + "\n");
  process.exitCode = 1;
});
