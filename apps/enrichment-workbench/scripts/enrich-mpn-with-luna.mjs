/* eslint-disable turbo/no-undeclared-env-vars, no-undef */
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const CATALOG_PATH = path.join(WORK_DIR, "catalog.jsonl");
const OUTPUT_PATH = path.join(WORK_DIR, "mpn-luna-enrichment.jsonl");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env["LUNA_MODEL"] || process.env["OFFICIAL_MODEL"] || "openai/gpt-5.6-luna";
const BATCH_SIZE = Math.max(1, Math.min(Number(process.env["LUNA_MPN_BATCH_SIZE"] || 4), 8));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env["LUNA_MPN_CONCURRENCY"] || 2), 16));
const DELAY_MS = Math.max(0, Number(process.env["LUNA_MPN_DELAY_MS"] || 250));
const LIMIT = Math.max(0, Number(process.env["LUNA_MPN_LIMIT"] || 0));
const WEB_SEARCH = process.env["LUNA_MPN_WEB_SEARCH"] !== "0";
const BUDGET_USD = Math.max(0, Number(process.env["LUNA_MPN_BUDGET_USD"] || process.env["ENRICHMENT_DAILY_BUDGET_USD"] || 25));

function loadEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  const raw = requireFile(ENV_PATH);
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requireFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return text(value).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function keyFor(brand, mpn) {
  const brandKey = normalize(brand);
  const mpnKey = normalize(mpn);
  return brandKey && mpnKey ? `${brandKey}|${mpnKey}` : "";
}

function isPlausiblePartNumber(value) {
  const normalized = normalize(value);
  return normalized.length >= 5 && /\d/.test(normalized) && !/^(UNKNOWN|MISSING|NONE|NA)$/.test(normalized);
}

function parseJson(value) {
  const raw = Array.isArray(value) ? value.map((part) => part?.text || "").join("") : String(value || "");
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Luna returned no JSON object");
  return JSON.parse(match[0]);
}

function confidenceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  const normalized = text(value).toUpperCase();
  if (normalized === "HIGH") return 0.9;
  if (normalized === "MEDIUM") return 0.65;
  if (normalized === "LOW") return 0.3;
  return 0;
}

function cleanFitment(row, index) {
  if (!row || typeof row !== "object") return null;
  const make = text(row.make);
  const model = text(row.model);
  if (!make || !model) return null;
  const yearStart = text(row.yearStart || row.startYear || row.year || "");
  const yearEnd = text(row.yearEnd || row.endYear || row.year || yearStart);
  if (!/^(?:19|20)\d{2}$/.test(yearStart) || !/^(?:19|20)\d{2}$/.test(yearEnd)) return null;
  return {
    id: `luna-mpn-fitment-${index}`,
    yearStart,
    yearEnd,
    make,
    model,
    trim: text(row.trim || row.submodel),
    engine: text(row.engine),
    notes: text(row.notes || row.evidence),
  };
}

function cleanResult(raw, requested) {
  const result = raw && typeof raw === "object" ? raw : {};
  const identityConfidence = confidenceNumber(result.identityConfidence);
  const fitmentConfidence = confidenceNumber(result.fitmentConfidence);
  const decision = text(result.decision).toUpperCase();
  const fitment = Array.isArray(result.fitment)
    ? result.fitment.map(cleanFitment).filter(Boolean).slice(0, 12)
    : [];
  const oeNumbers = Array.isArray(result.oeNumbers)
    ? [...new Set(result.oeNumbers.map((value) => typeof value === "object" ? text(value?.number) : text(value)).filter((value) => isPlausiblePartNumber(value) && normalize(value) !== normalize(requested.mpn)))]
    : [];
  const applyFitment = ["APPLY", "APPROVE", "MATCH"].includes(decision) && identityConfidence >= 0.85 && fitmentConfidence >= 0.85 && fitment.length > 0;
  return {
    key: requested.key,
    brand: requested.brand,
    mpn: requested.mpn,
    decision: decision === "APPLY" ? "APPLY" : "REVIEW",
    identityConfidence,
    productDescription: text(result.productDescription).slice(0, 80),
    oeNumbers,
    fitment: applyFitment ? fitment : [],
    fitmentConfidence,
    evidenceBasis: text(result.evidenceBasis).slice(0, 400),
    reason: text(result.reason).slice(0, 500),
    status: "ok",
    model: MODEL,
    sourceUrls: [...new Set([
      ...(Array.isArray(result.sources) ? result.sources.map((value) => typeof value === "object" ? text(value?.url) : text(value)) : []),
      ...[...text(result.evidenceBasis).matchAll(/https?:\/\/[^\s)\]}]+/gi)].map((match) => match[0]),
    ])].filter((value) => /^https?:\/\//i.test(value)).slice(0, 6),
  };
}

function buildPrompt(records) {
  return `Research these exact automotive Brand + MPN pairs using web search plus manufacturer/catalog knowledge. Search the exact Brand and exact MPN, prioritizing manufacturer and trusted catalog pages. Return JSON only with exactly {"results":[...]} and one result per input key.

Each result must contain: key, brand, mpn, decision (APPLY or REVIEW), identityConfidence (0-1), productDescription (2-8 words), oeNumbers (distinct OE cross-references only), fitment (array of rows with yearStart, yearEnd, make, model, trim, engine, notes), fitmentConfidence (0-1), evidenceBasis, reason.

Rules:
- Match the exact brand and exact MPN. Do not use a nearby number, substitute, supersession, or same-looking part.
- Never invent a vehicle application, year, OE number, or product type. If uncertain, return REVIEW with empty fitment.
- Add fitment only when this exact Brand + MPN is explicitly associated with the vehicle in reliable manufacturer/catalog data you know.
- Add an OE number only when it is a cross-reference distinct from the MPN.
- Keep fitment to the strongest representative rows; use year ranges only when documented.
- Product description must name the actual part type, not “automotive part”.

Input records:
${JSON.stringify(records)}`;
}

async function callLuna(records) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["OPENROUTER_API_KEY"]}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://partsbazar360.com",
      "X-Title": "PartsBazar360 Brand MPN fitment enrichment",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a strict automotive catalog researcher. Use web search and exact Brand + MPN evidence. Return valid JSON only." },
        { role: "user", content: buildPrompt(records) },
      ],
      temperature: 0.05,
      max_tokens: 5000,
      ...(WEB_SEARCH ? { plugins: [{ id: "web", max_results: 3 }] } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 500)}`);
  const data = JSON.parse(body);
  const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
  const parsed = parseJson(content);
  return { results: Array.isArray(parsed.results) ? parsed.results : [], usage: data.usage || null };
}

async function readCatalog() {
  const rows = [];
  const textValue = await readFile(CATALOG_PATH, "utf8");
  for (const line of textValue.split("\n")) {
    if (!line.trim()) continue;
    const listing = JSON.parse(line);
    if (listing.oemPartNumber || listing.existingCompatibilityReady) continue;
    const brand = text(listing.brand || listing.manufacturer);
    const mpn = text(listing.manufacturerPartNumber || listing.sellerSku);
    const key = keyFor(brand, mpn);
    if (!key) continue;
    rows.push({ key, brand, mpn });
  }
  const unique = new Map(rows.map((row) => [row.key, row]));
  return [...unique.values()];
}

async function readCompleted() {
  const completed = new Map();
  if (!existsSync(OUTPUT_PATH)) return completed;
  const raw = await readFile(OUTPUT_PATH, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.key && row.status === "ok") completed.set(row.key, row);
    } catch {
      // Ignore a partially written final line; the next run retries it.
    }
  }
  return completed;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function main() {
  loadEnvFile();
  if (!process.env["OPENROUTER_API_KEY"]) throw new Error("OPENROUTER_API_KEY is required in F:/apps/PartsBazar360/.env");
  if (!existsSync(CATALOG_PATH)) throw new Error(`Missing catalogue: ${CATALOG_PATH}`);
  await mkdir(WORK_DIR, { recursive: true });
  const records = await readCatalog();
  const completed = await readCompleted();
  const pending = records.filter((record) => !completed.has(record.key));
  const limited = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  const batches = [];
  for (let index = 0; index < limited.length; index += BATCH_SIZE) batches.push(limited.slice(index, index + BATCH_SIZE));
  const output = createWriteStream(OUTPUT_PATH, { flags: "a", encoding: "utf8" });
  let cursor = 0;
  let finished = 0;
  let applied = 0;
  let reviewed = 0;
  let spentUsd = 0;
  let budgetStopped = false;
  const worker = async () => {
    while (true) {
      if (BUDGET_USD > 0 && spentUsd >= BUDGET_USD) {
        budgetStopped = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) return;
      const batch = batches[index];
      try {
        const response = await callLuna(batch);
        spentUsd += Number(response.usage?.cost || 0);
        const byKey = new Map(response.results.map((result) => [text(result.key) || keyFor(result.brand, result.mpn), result]));
        for (const requested of batch) {
          const cleaned = cleanResult(byKey.get(requested.key) || {}, requested);
          cleaned.usage = response.usage;
          output.write(`${JSON.stringify(cleaned)}\n`);
          finished += 1;
          if (cleaned.fitment.length > 0) applied += 1;
          else reviewed += 1;
        }
      } catch (error) {
        for (const requested of batch) output.write(`${JSON.stringify({ key: requested.key, brand: requested.brand, mpn: requested.mpn, status: "error", error: text(error?.message || error), model: MODEL })}\n`);
        finished += batch.length;
      }
      if (finished % (BATCH_SIZE * 5) === 0 || finished === limited.length || budgetStopped) {
        process.stdout.write(JSON.stringify({ event: "progress", finished, total: limited.length, pendingAfterResume: pending.length, applied, reviewed, spentUsd, budgetUsd: BUDGET_USD, budgetStopped, model: MODEL }) + "\n");
      }
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length || 1) }, worker));
  await new Promise((resolve, reject) => {
    output.on("error", reject);
    output.end(resolve);
  });
  const meta = { model: MODEL, generatedAt: new Date().toISOString(), totalDistinct: records.length, resumedCompleted: completed.size, processedThisRun: finished, remainingAfterRun: Math.max(0, pending.length - finished), applied, reviewed, spentUsd, budgetUsd: BUDGET_USD, budgetStopped, batchSize: BATCH_SIZE, concurrency: CONCURRENCY };
  await writeFile(path.join(WORK_DIR, "mpn-luna-enrichment-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ event: "done", ...meta }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
