#!/usr/bin/env node

/**
 * Retrieve the client-side "Used In Vehicles" data from the official
 * PartsFinder JSON:API.  The public article HTML contains only a
 * PRODUCT_APPLICATIONS placeholder; the page loads makes first and then
 * application rows for each make.
 *
 * This script deliberately does not call an LLM.  It stores the official API
 * responses (including limitations) so the rows can be reviewed and validated
 * before they are applied to listing fitment.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..");
const TMP = path.join(ROOT, "tmp", "superior-enrichment-workbench");
const INPUTS = [
  path.join(TMP, "febi-url-luna-enrichment-batch-001.jsonl"),
  path.join(TMP, "febi-url-luna-enrichment-batch-002.jsonl"),
];
const DEFAULT_OUTPUT = path.join(TMP, "febi-partsfinder-applications.jsonl");
const API_ORIGIN = "https://partsfinder.bilsteingroup.com";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const country = argValue("country", "AE");
const locale = argValue("locale", "en");
const brand = argValue("brand", "FEBI");
const workers = Math.max(1, Number(argValue("workers", "16")) || 16);
const limit = Math.max(0, Number(argValue("limit", "0")) || 0);
const requestedMpn = String(argValue("mpn", "")).trim().toUpperCase();
const outputPath = path.resolve(argValue("output", DEFAULT_OUTPUT));
const cookiePath = path.resolve(argValue("cookies", path.join(process.cwd(), "tmp-partsfinder-cookies.txt")));

function parseCookieFile(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const normalized = line.startsWith("#HttpOnly_") ? line.slice(10) : line;
    if (normalized.startsWith("#")) continue;
    const parts = normalized.split("\t");
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts.slice(6).join("\t");
    if (name && value) entries.set(name, value);
  }
  return entries;
}

function cookieHeader(entries) {
  return [...entries.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function updateCookies(entries, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const value of values) {
    const first = value.split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator > 0) entries.set(first.slice(0, separator), first.slice(separator + 1));
  }
}

function officialUrl(routeMpn) {
  return `${API_ORIGIN}/${locale}/article/${brand.toLowerCase()}/${routeMpn}`;
}

function apiUrl(resource, params) {
  const url = new URL(`/api/${resource}`, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

function requestHeaders(sourceUrl, cookies) {
  return {
    Accept: "application/vnd.api+json",
    "accept-language": locale,
    "Content-Type": "application/vnd.api+json",
    Origin: API_ORIGIN,
    Referer: sourceUrl,
    "User-Agent": "PartsBazar360-official-application-retriever/1.0",
    Cookie: cookieHeader(cookies),
  };
}

async function fetchJson(url, sourceUrl, cookies, refreshPage) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: requestHeaders(sourceUrl, cookies),
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      updateCookies(cookies, response);
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { rawText: text.slice(0, 2000) };
      }
      if (response.ok) return { ok: true, status: response.status, body };
      if ((response.status === 401 || response.status === 403) && refreshPage) {
        await refreshPage();
        refreshPage = null;
      }
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      return { ok: false, status: response.status, body };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return { ok: false, status: 0, body: { error: String(lastError?.message || lastError) } };
}

async function readInputRecords() {
  const records = new Map();
  for (const file of INPUTS) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (String(row.brand || "").toUpperCase() !== brand) continue;
      const routeMpn = String(row.routeMpn || row.mpn || "").trim();
      const sourceUrl = row.sourceUrl || (routeMpn ? officialUrl(routeMpn) : "");
      if (!routeMpn || !sourceUrl) continue;
      const key = `${brand}|${routeMpn}`;
      if (!records.has(key)) records.set(key, {
        key,
        brand,
        mpn: String(row.mpn || routeMpn),
        routeMpn,
        sourceUrl,
        listingIds: row.listingIds || [],
        canonicalPartIds: row.canonicalPartIds || [],
        inputStatus: row.status || "",
      });
      else {
        const existing = records.get(key);
        existing.listingIds = [...new Set([...existing.listingIds, ...(row.listingIds || [])])];
        existing.canonicalPartIds = [...new Set([...existing.canonicalPartIds, ...(row.canonicalPartIds || [])])];
      }
    }
  }
  const all = [...records.values()]
    .filter((record) => !requestedMpn || record.mpn.toUpperCase() === requestedMpn || record.routeMpn.toUpperCase() === requestedMpn)
    .sort((a, b) => a.routeMpn.localeCompare(b.routeMpn, undefined, { numeric: true }));
  return limit ? all.slice(0, limit) : all;
}

async function readCompleted() {
  const completed = new Set();
  try {
    const text = await fs.readFile(outputPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      try {
        const row = JSON.parse(line);
        if (row.key) completed.add(row.key);
      } catch { /* ignore a partial final line */ }
    }
  } catch { /* first run */ }
  return completed;
}

async function retrieve(record, cookies) {
  // Preserve official not-found results without hitting the API.
  if (record.inputStatus === "not_found") {
    return { ...record, retrievedAt: new Date().toISOString(), apiOrigin: API_ORIGIN, country, locale, vehicleType: "CAR", status: "input_not_found", makes: [], applications: [], included: [], makesResponse: null, applicationResponses: [] };
  }
  const pageUrl = record.sourceUrl || officialUrl(record.routeMpn);
  const refreshPage = async () => {
    const response = await fetch(pageUrl, {
      headers: { "User-Agent": "PartsBazar360-official-application-retriever/1.0", Cookie: cookieHeader(cookies) },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    updateCookies(cookies, response);
    await response.arrayBuffer();
  };
  const makeRequestUrl = apiUrl("makes", {
    "filter[country]": country,
    "filter[articleId]": record.routeMpn,
    "filter[vehicleType]": "CAR",
    "filter[brands]": brand,
  });
  const makesResult = await fetchJson(makeRequestUrl, pageUrl, cookies, refreshPage);
  const makes = makesResult.ok && Array.isArray(makesResult.body?.data)
    ? makesResult.body.data.map((make) => ({
      id: String(make.id),
      title: make.attributes?.title || make.title || "",
      type: make.type,
    }))
    : [];
  const applicationResponses = [];
  for (const make of makes) {
    const applicationRequestUrl = apiUrl("applications", {
      "filter[country]": country,
      "filter[brands]": brand,
      articleId: record.routeMpn,
      locale,
      makeId: make.id,
      bgBrandId: "1",
      vehicleType: "CAR",
      include: "limitations",
    });
    const result = await fetchJson(applicationRequestUrl, pageUrl, cookies, refreshPage);
    applicationResponses.push({ requestUrl: applicationRequestUrl, ...result });
  }
  const applications = applicationResponses.flatMap((result) =>
    result.ok && Array.isArray(result.body?.data) ? result.body.data : []);
  const included = applicationResponses.flatMap((result) =>
    result.ok && Array.isArray(result.body?.included) ? result.body.included : []);
  const status = !makesResult.ok
    ? "makes_http_error"
    : applications.length > 0
      ? "ok"
      : makes.length > 0
        ? "makes_without_application_rows"
        : "no_used_in_vehicles_rows";
  return {
    ...record,
    retrievedAt: new Date().toISOString(),
    apiOrigin: API_ORIGIN,
    country,
    locale,
    vehicleType: "CAR",
    status,
    makes,
    applications,
    included,
    makesResponse: { requestUrl: makeRequestUrl, ...makesResult },
    applicationResponses,
  };
}

const cookies = parseCookieFile(await fs.readFile(cookiePath, "utf8"));
const records = await readInputRecords();
const completed = await readCompleted();
const pending = records.filter((record) => !completed.has(record.key));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
console.log(JSON.stringify({ event: "start", total: records.length, pending: pending.length, completed: completed.size, workers, country, output: outputPath }));

let next = 0;
let done = completed.size;
let writeQueue = Promise.resolve();
let failures = 0;
const startedAt = Date.now();
async function worker() {
  while (true) {
    const index = next++;
    if (index >= pending.length) return;
    const record = pending[index];
    let result;
    try {
      result = await retrieve(record, cookies);
    } catch (error) {
      failures += 1;
      result = { ...record, retrievedAt: new Date().toISOString(), status: "worker_error", error: String(error?.stack || error) };
    }
    writeQueue = writeQueue.then(() => fs.appendFile(outputPath, `${JSON.stringify(result)}\n`));
    await writeQueue;
    done += 1;
    const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
    const rate = (done - completed.size) / elapsedSeconds;
    const remaining = Math.max(0, records.length - done);
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
    console.log(JSON.stringify({ event: "progress", done, total: records.length, pendingRemaining: remaining, key: record.key, status: result.status, makes: result.makes?.length || 0, applications: result.applications?.length || 0, ratePerSecond: Number(rate.toFixed(3)), etaSeconds }));
  }
}

await Promise.all(Array.from({ length: Math.min(workers, Math.max(1, pending.length)) }, () => worker()));
await writeQueue;
console.log(JSON.stringify({ event: "complete", total: records.length, retrieved: done - completed.size, completed: done, failures, output: outputPath }));

