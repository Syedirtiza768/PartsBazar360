/* eslint-disable turbo/no-undeclared-env-vars, no-undef */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const CATALOG_PATH = path.join(WORK_DIR, "catalog.jsonl");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// This runner is intentionally pinned: the Lemforder pilot must be Luna-only.
const MODEL = "openai/gpt-5.6-luna";
const LIMIT = Math.max(1, Math.min(Number(process.env["LEMFORDER_FCPEURO_LUNA_LIMIT"] || 5), 2000));
const OFFSET = Math.max(0, Number(process.env["LEMFORDER_FCPEURO_LUNA_OFFSET"] || 0));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env["LEMFORDER_FCPEURO_LUNA_CONCURRENCY"] || 1), 4));
const MAX_RETRIES = Math.max(1, Math.min(Number(process.env["LEMFORDER_FCPEURO_LUNA_RETRIES"] || 3), 6));
const DELAY_MS = Math.max(0, Number(process.env["LEMFORDER_FCPEURO_LUNA_DELAY_MS"] || 150));
const BUDGET_USD = Math.max(0, Number(process.env["LEMFORDER_FCPEURO_LUNA_BUDGET_USD"] || 15));
const BATCH_NAME = process.env["LEMFORDER_FCPEURO_LUNA_BATCH"] || "pilot-001";
const OUTPUT_PATH = path.join(WORK_DIR, `lemforder-fcpeuro-luna-enrichment-batch-${BATCH_NAME}.jsonl`);
const MANIFEST_PATH = path.join(WORK_DIR, `lemforder-fcpeuro-luna-batch-${BATCH_NAME}.json`);
const META_PATH = path.join(WORK_DIR, `lemforder-fcpeuro-luna-batch-${BATCH_NAME}-meta.json`);
const GAP_MPN_PATH = process.env["LEMFORDER_FCPEURO_LUNA_GAP_MPN_PATH"] || "";
const REFRESH_GAPS = process.env["LEMFORDER_FCPEURO_LUNA_REFRESH_GAPS"] === "1";

function readGapMpns() {
  if (!GAP_MPN_PATH || !existsSync(GAP_MPN_PATH)) return null;
  return new Set(readFileSync(GAP_MPN_PATH, "utf8").split(/\r?\n/).map(routeMpn).filter(Boolean));
}

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
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function searchUrl(mpn) {
  return `https://www.fcpeuro.com/Parts?keywords=${encodeURIComponent(`LEM-${routeMpn(mpn)}`)}`;
}

function isFcpeuroUrl(value, pathPrefix = "") {
  try {
    const parsed = new URL(text(value));
    return /^(?:www\.)?fcpeuro\.com$/i.test(parsed.hostname) && (!pathPrefix || parsed.pathname.startsWith(pathPrefix));
  } catch {
    return false;
  }
}

function parseJson(content) {
  const raw = Array.isArray(content)
    ? content.map((block) => block?.text || "").join("")
    : String(content || "");
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Luna returned no JSON object");
  return JSON.parse(match[0]);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function cleanSearchResults(values) {
  return (Array.isArray(values) ? values : [])
    .map((item, index) => ({
      position: Number(item?.position || item?.index || index + 1),
      title: text(item?.title || item?.name),
      shortDescription: text(item?.shortDescription || item?.description || item?.snippet),
      url: text(item?.url || item?.href),
    }))
    .filter((item) => item.title || item.shortDescription || item.url)
    .slice(0, 5);
}

function cleanItemSpecifics(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "string"
        ? { name: item, value: "" }
        : { name: text(item?.name || item?.label || item?.key), value: text(item?.value || item?.text) })
      .filter((item) => item.name || item.value);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, item]) => ({ name: text(name), value: text(item) }))
      .filter((item) => item.name || item.value);
  }
  return [];
}

function cleanFitment(value) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      id: `lemforder-fcpeuro-${index + 1}`,
      yearStart: text(item?.yearStart || item?.startYear || item?.fromYear || item?.year),
      yearEnd: text(item?.yearEnd || item?.endYear || item?.toYear || item?.year),
      make: text(item?.make || item?.vehicleMake || item?.manufacturer),
      model: text(item?.model || item?.vehicleModel),
      trim: text(item?.trim || item?.submodel || item?.variant),
      engine: text(item?.engine || item?.engineSpecification),
      notes: text(item?.notes || item?.qualifier || item?.limitations),
    }))
    .filter((item) => item.make || item.model || item.yearStart || item.trim || item.engine || item.notes);
}

function cleanReferences(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => typeof item === "string"
      ? { make: "", numbers: [text(item)] }
      : { make: text(item?.make || item?.brand), numbers: uniqueStrings(item?.numbers || item?.references || item?.referenceNumbers) })
    .filter((item) => item.make || item.numbers.length > 0);
}

function cleanImageUrls(value) {
  return uniqueStrings(value)
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => !/placeholder|no[-_ ]?image|default[-_ ]?image|logo/i.test(url));
}

function costFromUsage(usage) {
  const candidates = [
    usage?.cost,
    usage?.total_cost,
    usage?.cost_details?.upstream_inference_cost,
    usage?.cost_details?.total_cost,
  ];
  const cost = candidates.map(Number).find((value) => Number.isFinite(value));
  return cost || 0;
}

function cleanResult(raw, requested, usage) {
  const result = raw && typeof raw === "object" ? raw : {};
  const searchResults = cleanSearchResults(result.searchResults || result.results);
  const selectedResultIndex = Number(result.selectedResultIndex || result.resultIndex || requested.expectedResultIndex) || requested.expectedResultIndex;
  const selectedProductUrl = text(result.selectedProductUrl || result.productUrl || result.sourceUrl);
  const fitment = cleanFitment(result.fitment || result.compatibility || result.vehicleApplications);
  const itemSpecifics = cleanItemSpecifics(result.itemSpecifics || result.item_specifics || result.attributes || result.specifications);
  const imageUrls = cleanImageUrls(result.imageUrls || result.images || result.imageURL);
  const status = text(result.status || (isFcpeuroUrl(selectedProductUrl, "/products/") ? "ok" : "review")).toLowerCase();
  return {
    key: requested.key,
    brand: "LEMFORDER",
    mpn: requested.mpn,
    routeMpn: requested.routeMpn,
    listingIds: requested.listingIds,
    canonicalPartIds: requested.canonicalPartIds,
    highestPrice: requested.highestPrice,
    currency: requested.currency,
    applicationShortDescription: requested.applicationShortDescription,
    kitMentioned: requested.kitMentioned,
    expectedResultIndex: requested.expectedResultIndex,
    searchUrl: requested.searchUrl,
    selectedResultIndex,
    selectedProductUrl,
    searchResults,
    status: status === "ok" && isFcpeuroUrl(selectedProductUrl, "/products/") ? "ok" : "review",
    pageStatus: text(result.pageStatus || result.sourceStatus),
    title: text(result.title || result.productTitle),
    description: text(result.description || result.productDescription),
    vehicleTitle: text(result.vehicleTitle || result.fitmentTitle || result.applicationTitle || result.vehicleApplicationsTitle),
    manufacturerPartNumber: text(result.manufacturerPartNumber || result.partNumber || result.mpn),
    itemSpecifics,
    imageUrls,
    oeReferences: cleanReferences(result.oeReferences || result.oeNumbers || result.crossReferences),
    fitment,
    fitmentStatus: fitment.length > 0 ? "confirmed_from_fcpeuro_page" : text(result.fitmentStatus || "not_confirmed"),
    evidence: text(result.evidence || result.notes).slice(0, 1200),
    exactMatchConfidence: Number(result.exactMatchConfidence || result.identityConfidence || 0) || 0,
    model: MODEL,
    usage,
    costUsd: costFromUsage(usage),
  };
}

function buildPrompt(requested) {
  return `Use only FCPEuro pages for this exact Lemforder MPN. You must fetch the exact search URL first, then fetch the selected FCPEuro product URL. Do not use another site, prior knowledge, a nearby MPN, a supersession, or an inferred product page.

Search URL: ${requested.searchUrl}
Requested brand: LEMFORDER
Requested MPN: ${requested.mpn}
Application short description from the workbench: ${requested.applicationShortDescription || "(empty)"}
The application short description contains the standalone word "kit": ${requested.kitMentioned ? "YES" : "NO"}
The required search-result position is: ${requested.expectedResultIndex}

Selection rule:
1. On the search page, preserve the first five product results in their visible relevance order and their exact product hrefs.
2. Select result 1 by default. Select result 2 only when the supplied application short description contains the standalone word "kit". This is a deterministic rule; do not change it based on your own product interpretation.
3. Fetch the exact selected product URL. If the required result or product URL cannot be verified from FCPEuro, return status review and do not fabricate a URL or fields.

From the selected product page, extract all available data: product title, short/long description, the visible vehicle/application title line when FCPEuro shows one directly below or beside the product title, every product image URL, every Item Specifics name/value pair, all visible vehicle Fitment/application rows, and distinct OE/cross-reference numbers. Preserve the page's values without guessing. The MPN itself is not an OE number.

Return JSON only in this shape:
{"status":"ok|review","pageStatus":"","selectedResultIndex":1,"selectedProductUrl":"","title":"","vehicleTitle":"","description":"","manufacturerPartNumber":"","itemSpecifics":[{"name":"","value":""}],"imageUrls":[""],"oeReferences":[{"make":"","numbers":[""]}],"fitment":[{"make":"","model":"","yearStart":"","yearEnd":"","trim":"","engine":"","notes":""}],"fitmentStatus":"confirmed_from_fcpeuro_page|not_confirmed","searchResults":[{"position":1,"title":"","shortDescription":"","url":""}],"evidence":"","exactMatchConfidence":0}

Return all visible fitment rows and image URLs from the fetched product page. If fitment is absent or client-rendered but not present in fetched content, return an empty fitment array and fitmentStatus not_confirmed. Never invent fitment, item specifics, images, OE numbers, or a product URL.`;
}

async function callLuna(requested) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["OPENROUTER_API_KEY"]}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://partsbazar360.com",
          "X-Title": "PartsBazar360 Lemforder FCPEuro Luna pilot",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You are a strict automotive catalogue extractor. Use only the supplied FCPEuro pages and return valid JSON." },
            { role: "user", content: buildPrompt(requested) },
          ],
          tools: [{
            type: "openrouter:web_fetch",
            parameters: {
              engine: "openrouter",
              max_uses: 2,
              max_content_tokens: 60000,
              allowed_domains: ["www.fcpeuro.com", "fcpeuro.com"],
            },
          }],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 16000,
        }),
        signal: AbortSignal.timeout(240000),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 500)}`);
      const data = JSON.parse(body);
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
      const usage = data.usage || null;
      return { result: cleanResult(parseJson(content), requested, usage), usage };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1000 * 2 ** (attempt - 1))));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readCatalog() {
  const raw = await readFile(CATALOG_PATH, "utf8");
  const listings = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const lemforder = listings
    .filter((listing) => [listing.brand, listing.manufacturer, listing.titleBrand].some((value) => normalized(value) === "LEMFORDER"))
    .map((listing, index) => {
      const mpn = text(listing.manufacturerPartNumber || listing.sellerSku);
      const applicationShortDescription = text(listing.originalTitle || listing.suggestedTitle || listing.productType || listing.category);
      return {
        listingId: text(listing.listingId),
        canonicalPartId: text(listing.canonicalPartId),
        brand: "LEMFORDER",
        mpn,
        routeMpn: routeMpn(mpn),
        price: parsePrice(listing.price),
        currency: text(listing.currency),
        originalTitle: text(listing.originalTitle),
        applicationShortDescription,
        currentImageUrls: Array.isArray(listing.currentImageUrls) ? listing.currentImageUrls.map(text).filter(Boolean) : [],
        sourceUpdatedAt: text(listing.sourceUpdatedAt),
        _index: index,
      };
    })
    .filter((listing) => listing.mpn && listing.routeMpn);
  lemforder.sort((left, right) => right.price - left.price || left._index - right._index);

  const byKey = new Map();
  for (const listing of lemforder) {
    const key = `LEMFORDER|${normalized(listing.mpn)}`;
    const kitMentioned = /\bkit\b/i.test(listing.applicationShortDescription);
    const existing = byKey.get(key);
    if (existing) {
      existing.listingIds.push(listing.listingId);
      existing.canonicalPartIds.push(listing.canonicalPartId);
      existing.prices.push(listing.price);
      existing.originalTitles.push(listing.originalTitle);
      existing.applicationDescriptions.push(listing.applicationShortDescription);
      existing.currentImageUrls.push(...listing.currentImageUrls);
      existing.kitMentioned ||= kitMentioned;
      existing.expectedResultIndex = existing.kitMentioned ? 2 : 1;
      continue;
    }
    byKey.set(key, {
      key,
      brand: "LEMFORDER",
      mpn: listing.mpn,
      routeMpn: listing.routeMpn,
      searchUrl: searchUrl(listing.mpn),
      listingIds: [listing.listingId],
      canonicalPartIds: [listing.canonicalPartId],
      prices: [listing.price],
      currency: listing.currency,
      originalTitles: [listing.originalTitle],
      applicationDescriptions: [listing.applicationShortDescription],
      applicationShortDescription: listing.applicationShortDescription,
      kitMentioned,
      expectedResultIndex: kitMentioned ? 2 : 1,
      currentImageUrls: [...listing.currentImageUrls],
      sourceUpdatedAt: listing.sourceUpdatedAt,
    });
  }
  const requests = [...byKey.values()].map((item) => ({
    ...item,
    highestPrice: Math.max(...item.prices),
  }));
  requests.sort((left, right) => right.highestPrice - left.highestPrice || left.key.localeCompare(right.key));
  const selectedRequests = requests.slice(OFFSET, OFFSET + LIMIT);
  const selectedKeys = new Set(selectedRequests.map((request) => request.key));
  const selectedListings = lemforder.filter((listing) => selectedKeys.has("LEMFORDER|" + normalized(listing.mpn)));
  return { selectedListings, requests: selectedRequests };
}

async function readCompleted() {
  const completed = new Set();
  const outputPaths = readdirSync(WORK_DIR)
    .filter((name) => /^lemforder-fcpeuro-luna-enrichment-batch-.*\.jsonl$/i.test(name))
    .map((name) => path.join(WORK_DIR, name));
  for (const outputPath of outputPaths) {
    if (!existsSync(outputPath)) continue;
    const raw = await readFile(outputPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.key && row.status !== "error") completed.add(row.key);
      } catch {
        // Ignore a partial final line so the run can resume safely.
      }
    }
  }
  return completed;
}

async function main() {
  loadEnvFile();
  if (!process.env["OPENROUTER_API_KEY"]) throw new Error(`OPENROUTER_API_KEY is missing from ${ENV_PATH}`);
  if (!existsSync(CATALOG_PATH)) throw new Error(`Missing catalogue: ${CATALOG_PATH}`);
  await mkdir(WORK_DIR, { recursive: true });
  const data = await readCatalog();
  const gapMpns = readGapMpns();
  const selectedListings = gapMpns
    ? data.selectedListings.filter((listing) => gapMpns.has(routeMpn(listing.manufacturerPartNumber || listing.sellerSku)))
    : data.selectedListings;
  const requests = gapMpns
    ? data.requests.filter((request) => gapMpns.has(routeMpn(request.mpn)))
    : data.requests;
  const completed = await readCompleted();
  const pending = requests.filter((request) => REFRESH_GAPS || !completed.has(request.key));
  await writeFile(MANIFEST_PATH, JSON.stringify({
    batch: BATCH_NAME,
    model: MODEL,
    source: "FCPEuro search URL plus selected FCPEuro product URL fetched by Luna",
    offset: OFFSET,
    limit: LIMIT,
    selectionRule: "First search result unless the application short description contains the standalone word kit, then second search result",
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
  let itemSpecifics = 0;
  let failed = 0;
  let stoppedByBudget = false;
  let appendChain = Promise.resolve();
  const appendResult = async (row) => {
    appendChain = appendChain.then(() => appendFile(OUTPUT_PATH, `${JSON.stringify(row)}\n`, "utf8"));
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
      if (BUDGET_USD > 0 && spentUsd >= BUDGET_USD) {
        stoppedByBudget = true;
        return;
      }
      try {
        const response = await callLuna(requested);
        const cost = costFromUsage(response.usage);
        spentUsd += cost;
        processed += 1;
        if (response.result.status === "ok") applied += 1;
        if (response.result.fitment.length > 0) fullFitment += 1;
        if (response.result.itemSpecifics.length > 0) itemSpecifics += 1;
        await appendResult(response.result);
        process.stdout.write(`[${processed}/${pending.length}] worker=${workerId} ${requested.mpn} ${requested.currency} ${requested.highestPrice.toFixed(2)} result=${response.result.selectedResultIndex} fitment=${response.result.fitment.length} specifics=${response.result.itemSpecifics.length} cost=$${spentUsd.toFixed(6)}\n`);
      } catch (error) {
        failed += 1;
        await appendResult({
          key: requested.key,
          brand: requested.brand,
          mpn: requested.mpn,
          routeMpn: requested.routeMpn,
          listingIds: requested.listingIds,
          canonicalPartIds: requested.canonicalPartIds,
          highestPrice: requested.highestPrice,
          currency: requested.currency,
          applicationShortDescription: requested.applicationShortDescription,
          kitMentioned: requested.kitMentioned,
          expectedResultIndex: requested.expectedResultIndex,
          searchUrl: requested.searchUrl,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          model: MODEL,
        });
        process.stdout.write(`[error ${processed + failed}/${pending.length}] worker=${workerId} ${requested.mpn}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, (_, index) => worker(index + 1)));
  const meta = {
    offset: OFFSET,
    limit: LIMIT,
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
    itemSpecifics,
    failed,
    remaining: Math.max(0, pending.length - processed - failed),
    spentUsd,
    averageCostPerUniqueMpnUsd: processed > 0 ? spentUsd / processed : 0,
    averageCostPerSelectedListingUsd: selectedListings.length > 0 ? spentUsd / selectedListings.length : 0,
    budgetUsd: BUDGET_USD,
    budgetStopped: stoppedByBudget,
    concurrency: CONCURRENCY,
    selectionRule: "First search result unless the application short description contains the standalone word kit, then second search result",
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(meta)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
