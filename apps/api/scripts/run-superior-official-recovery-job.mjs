#!/usr/bin/env node

/**
 * Resumable server-side coordinator for the Superior Auto Parts official-brand
 * recovery pass.
 *
 * You.com is used for source discovery. The discovered first-party page is
 * fetched and checked again before it is handed to the existing Luna writer.
 * The coordinator never substitutes reseller images and never advances a row
 * into the writer without exact brand + MPN + image evidence.
 *
 * Run inside the API/worker image:
 *   node scripts/run-superior-official-recovery-job.mjs
 *
 * Useful environment variables:
 *   OFFICIAL_BRAND=FEBI
 *   OFFICIAL_DOMAIN=partsfinder.bilsteingroup.com
 *   OFFICIAL_URL_TEMPLATE=https://partsfinder.bilsteingroup.com/en_US/article/febi/{mpn}
 *   OFFICIAL_JOB_BATCH=20
 *   OFFICIAL_JOB_WORKERS=4
 *   OFFICIAL_YOU_WORKERS=4
 *   OFFICIAL_JOB_STATE_DIR=/app/data/enrichment/superior-official-recovery
 *   YDC_API_KEY=...                 # optional; enables paid MCP limits
 *   YOU_MCP_URL=https://api.you.com/mcp?profile=free
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Client as PgClient } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';
const BRAND = String(process.env.OFFICIAL_BRAND || 'FEBI').trim();
const DOMAIN = String(process.env.OFFICIAL_DOMAIN || 'partsfinder.bilsteingroup.com').trim();
const URL_TEMPLATE = String(
  process.env.OFFICIAL_URL_TEMPLATE ||
  'https://partsfinder.bilsteingroup.com/en_US/article/febi/{mpn}',
).trim();
const BATCH_SIZE = Math.max(1, Math.min(Number.parseInt(process.env.OFFICIAL_JOB_BATCH || '20', 10) || 20, 100));
const JOB_WORKERS = Math.max(1, Math.min(Number.parseInt(process.env.OFFICIAL_JOB_WORKERS || '4', 10) || 4, 8));
const YOU_WORKERS = Math.max(1, Math.min(Number.parseInt(process.env.OFFICIAL_YOU_WORKERS || '4', 10) || 4, 8));
const LUNA_WORKERS = Math.max(1, Math.min(Number.parseInt(process.env.OFFICIAL_WORKERS || '4', 10) || 4, 8));
const MAX_BATCHES = Math.max(0, Number.parseInt(process.env.OFFICIAL_MAX_BATCHES || '0', 10) || 0);
const STATE_DIR = process.env.OFFICIAL_JOB_STATE_DIR || '/app/data/enrichment/superior-official-recovery';
const MCP_URL = process.env.YOU_MCP_URL || (process.env.YDC_API_KEY ? 'https://api.you.com/mcp' : 'https://api.you.com/mcp?profile=free');
const YDC_API_KEY = process.env.YDC_API_KEY || '';
const WRITER = path.join(process.cwd(), 'scripts', 'apply-superior-official-recovery.mjs');
const USER_AGENT = 'PartsBazar360/1.0 (+https://partsbazar360.com; official recovery job)';

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

fs.mkdirSync(STATE_DIR, { recursive: true });
const statusPath = path.join(STATE_DIR, 'status.json');
const eventsPath = path.join(STATE_DIR, 'events.ndjson');
const lockPath = path.join(STATE_DIR, 'job.lock');
const feedPath = path.join(STATE_DIR, 'current-feed.json');

function now() { return new Date().toISOString(); }
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function token(value) { return clean(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function clip(value, max) {
  const valueText = String(value ?? '');
  return valueText.length <= max ? valueText : `${valueText.slice(0, max - 1)}…`;
}
function hostAllowed(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const domain = DOMAIN.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
function normalizeUrl(value) {
  try {
    const url = new URL(clean(value));
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}
function exactPartNumber(value, mpn) {
  const raw = String(value ?? '').normalize('NFKC').toUpperCase();
  const wanted = token(mpn);
  if (!raw || !wanted) return false;
  const pattern = wanted.split('').join('[^A-Z0-9]*');
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?:$|[^A-Z0-9])`, 'i').test(raw)
    || token(raw).includes(wanted);
}
function imageUrls(value) {
  const raw = String(value || '').replaceAll('\\/', '/');
  const found = [];
  const markdown = /!\[[^\]]*\]\((https?:\/\/[^)\s>]+)\)/gi;
  const html = /(?:src|content)=['"](https?:\/\/[^'"]+)['"]/gi;
  const generic = /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?)/gi;
  for (const match of raw.matchAll(markdown)) found.push(match[1]);
  for (const match of raw.matchAll(html)) found.push(match[1]);
  for (const match of raw.matchAll(generic)) found.push(match[1]);
  return [...new Set(found.map(normalizeUrl).filter(Boolean))];
}
function imageForPart(content, mpn) {
  const wanted = token(mpn);
  return imageUrls(content).find((url) => {
    const normalized = token(url);
    return normalized.includes(wanted) && !/ROBOT|PFMAILSELF|LOGO|FAVICON/.test(normalized);
  }) || null;
}
function officialUrl(mpn) {
  return URL_TEMPLATE.replace('{mpn}', encodeURIComponent(String(mpn))).trim();
}

const state = {
  jobId: `superior-official-${BRAND.toLowerCase()}`,
  status: 'starting',
  brand: BRAND,
  officialDomain: DOMAIN,
  youMode: YDC_API_KEY ? 'mcp-api-key' : 'mcp-free-profile',
  batchSize: BATCH_SIZE,
  workers: { coordinator: JOB_WORKERS, you: YOU_WORKERS, luna: LUNA_WORKERS },
  startedAt: now(),
  updatedAt: now(),
  batches: 0,
  selected: 0,
  searched: 0,
  evidenceAccepted: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  lastCursor: process.env.OFFICIAL_JOB_CURSOR || null,
  queueRemaining: null,
  lastBatch: null,
  lastUrls: [],
  error: null,
};

if (!process.env.OFFICIAL_JOB_CURSOR && fs.existsSync(statusPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (previous.jobId === state.jobId && previous.status !== 'complete') {
      Object.assign(state, previous, {
        status: 'starting',
        error: null,
        updatedAt: now(),
        youMode: YDC_API_KEY ? 'mcp-api-key' : 'mcp-free-profile',
      });
    }
  } catch {}
}

function saveStatus() {
  state.updatedAt = now();
  const temp = `${statusPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, statusPath);
}
function event(type, data = {}) {
  const record = { at: now(), type, ...data };
  fs.appendFileSync(eventsPath, `${JSON.stringify(record)}\n`);
  return record;
}
function log(type, data = {}) {
  const record = event(type, data);
  console.log(JSON.stringify(record));
  saveStatus();
}
function acquireLock() {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
  } catch {
    throw new Error(`job lock exists: ${lockPath}`);
  }
}
function releaseLock() {
  try { fs.unlinkSync(lockPath); } catch {}
}

let requestId = 0;
function parseMcpResponse(raw) {
  const matches = [...String(raw || '').matchAll(/(?:^|\n)data:\s*(\{[\s\S]*?\})(?=\n|$)/g)];
  const payload = matches.length ? matches.at(-1)[1] : String(raw || '').trim();
  const response = JSON.parse(payload);
  if (response.error) throw new Error(`You.com MCP ${response.error.code}: ${response.error.message}`);
  const textBlock = (response.result?.content || []).find((block) => block.type === 'text')?.text;
  if (textBlock && textBlock !== 'No results found.') {
    try { return JSON.parse(textBlock); } catch {}
  }
  return response.result?.structuredContent || {};
}
async function youSearch(query) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(YDC_API_KEY ? { Authorization: `Bearer ${YDC_API_KEY}` } : {}),
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method: 'tools/call',
      params: {
        name: 'you-search',
        arguments: {
          query,
          count: 100,
          livecrawl: 'web',
          livecrawl_formats: ['markdown'],
          crawl_timeout: 30,
          language: 'EN',
        },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`You.com MCP HTTP ${response.status}: ${body.slice(0, 300)}`);
  return parseMcpResponse(body);
}

async function fetchOfficialPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  return { ok: response.ok, status: response.status, html: clip(html, 24000), finalUrl: normalizeUrl(response.url || url) };
}

function resultFields(result) {
  return [result.url, result.title, result.description, ...(result.snippets || []), result.contents?.markdown, result.contents?.html]
    .filter(Boolean).join('\n');
}
function candidateUrls(result) {
  const raw = resultFields(result).replaceAll('\\/', '/');
  const urls = [...raw.matchAll(/https?:\/\/[^\s)"'<>]+/gi)].map((match) => match[0].replace(/[.,;]+$/, ''));
  return [...new Set([result.url, ...urls].map(normalizeUrl).filter(hostAllowed))];
}

async function discoverBatch(rows) {
  const quoted = rows.map((row) => `"${clean(row.mpn).replaceAll('"', '')}"`).join(' OR ');
  const query = `${BRAND} (${quoted})`;
  const search = await youSearch(query);
  const results = search?.results?.web || [];
  const accepted = [];
  const seen = new Set();
  const queue = [...rows];
  async function resolveOne(row) {
    const candidates = [];
    for (const result of results) {
      const fields = resultFields(result);
      if (!exactPartNumber(fields, row.mpn)) continue;
      candidates.push({ result, url: candidateUrls(result).find((value) => new URL(value).pathname.toLowerCase().includes('/article/')) });
    }
    const deterministic = officialUrl(row.mpn);
    if (hostAllowed(deterministic)) candidates.push({ result: null, url: deterministic });
    let evidence = null;
    for (const candidate of candidates) {
      let url = normalizeUrl(candidate.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      let page = candidate.result?.contents?.markdown || candidate.result?.contents?.html || '';
      let pageTitle = candidate.result?.title || '';
      let pageDescription = candidate.result?.description || '';
      if (!exactPartNumber(`${pageTitle}\n${page}`, row.mpn) || !imageForPart(page, row.mpn)) {
        const fetched = await fetchOfficialPage(url);
        if (!fetched.ok || !hostAllowed(fetched.finalUrl)) continue;
        page = fetched.html;
        url = fetched.finalUrl || url;
        pageTitle = pageTitle || `${BRAND} ${row.mpn} official catalog page`;
        pageDescription = pageDescription || `Official ${BRAND} catalog entry for article ${row.mpn}.`;
      }
      const context = `${pageTitle}\n${pageDescription}\n${page}`;
      const imageUrl = imageForPart(context, row.mpn);
      if (!exactPartNumber(context, row.mpn) || !imageUrl) continue;
      evidence = {
        officialDomain: DOMAIN,
        sourceUrl: url,
        pageTitle,
        pageDescription,
        snippets: candidate.result?.snippets || [],
        pageContent: page,
        imageUrl,
      };
      break;
    }
    if (evidence) {
      accepted.push({ ...row, official: evidence });
    }
  }
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (row) await resolveOne(row);
    }
  }
  await Promise.all(Array.from({ length: Math.min(YOU_WORKERS, rows.length || 1) }, () => worker()));
  return { query, results: results.length, accepted };
}

async function selectRows(client, cursor) {
  const result = await client.query(
    `SELECT DISTINCT ON (cp.id)
       cp.id, cp.brand, cp."manufacturerPartNumber" AS mpn, cp.title, cp.description,
       cp."itemSpecifics", cp.compatibility
     FROM "CanonicalPart" cp
     JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
     WHERE so."sellerId" = 'seller-superior-auto-parts'
       AND so.status = 'ACTIVE'
       AND UPPER(cp.brand) = UPPER($1)
       AND COALESCE(array_length(cp."imageUrls", 1), 0) = 0
       AND ($2::text IS NULL OR cp.id > $2::text)
     ORDER BY cp.id, so."updatedAt" DESC
     LIMIT $3`,
    [BRAND, cursor, BATCH_SIZE],
  );
  return result.rows;
}
async function remainingRows(client, cursor) {
  const result = await client.query(
     `SELECT COUNT(DISTINCT cp.id)::int AS count
     FROM "CanonicalPart" cp
     JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
     WHERE so."sellerId" = 'seller-superior-auto-parts'
       AND so.status = 'ACTIVE'
       AND UPPER(cp.brand) = UPPER($1)
       AND COALESCE(array_length(cp."imageUrls", 1), 0) = 0
       AND ($2::text IS NULL OR cp.id > $2::text)`,
    [BRAND, cursor],
  );
  return result.rows[0]?.count ?? null;
}

function runWriter(rows) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER], {
      env: { ...process.env, OFFICIAL_WORKERS: String(LUNA_WORKERS), OFFICIAL_SOURCE: 'you.com:server-official-recovery-v1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = [];
    const read = createInterface({ input: child.stdout });
    read.on('line', (line) => {
      try {
        const result = JSON.parse(line);
        output.push(result);
        event('row', result);
        if (result.status === 'updated') state.updated += 1;
        else if (result.status === 'failed') state.failed += 1;
        else state.skipped += 1;
        state.lastUrls = [result.productUrl, ...state.lastUrls].filter(Boolean).slice(0, 10);
        saveStatus();
        console.log(line);
      } catch {
        console.log(line);
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`writer exited ${code}`)));
    child.stdin.end(JSON.stringify({ rows }));
  });
}

async function main() {
  acquireLock();
  saveStatus();
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    state.status = 'running';
    log('started', { pid: process.pid, mcpUrl: MCP_URL.replace(/\?.*$/, '') });
    let cursor = state.lastCursor || null;
    while (true) {
      if (MAX_BATCHES && state.batches >= MAX_BATCHES) break;
      const rows = await selectRows(client, cursor);
      if (!rows.length) break;
      state.batches += 1;
      state.selected += rows.length;
      state.lastBatch = { number: state.batches, firstId: rows[0].id, lastId: rows.at(-1).id, selected: rows.length, startedAt: now() };
      log('batch_selected', { batch: state.batches, selected: rows.length, firstMpn: rows[0].mpn, lastMpn: rows.at(-1).mpn });
      let discovered;
      try {
        discovered = await discoverBatch(rows);
      } catch (error) {
        state.error = clean(error?.message || error);
        log('batch_error', { batch: state.batches, error: state.error });
        throw error;
      }
      state.searched += rows.length;
      state.evidenceAccepted += discovered.accepted.length;
      state.skipped += rows.length - discovered.accepted.length;
      fs.writeFileSync(feedPath, `${JSON.stringify({ rows: discovered.accepted }, null, 2)}\n`);
      log('evidence_ready', { batch: state.batches, query: discovered.query, searchResults: discovered.results, evidenceAccepted: discovered.accepted.length, noEvidence: rows.length - discovered.accepted.length });
      const results = discovered.accepted.length ? await runWriter(discovered.accepted) : [];
      cursor = rows.at(-1).id;
      state.lastCursor = cursor;
      state.queueRemaining = await remainingRows(client, cursor);
      state.lastBatch.finishedAt = now();
      state.lastBatch.updated = results.filter((item) => item.status === 'updated').length;
      state.lastBatch.writerRows = results.length;
      log('batch_finished', { batch: state.batches, cursor, queueRemaining: state.queueRemaining, updated: state.lastBatch.updated, accepted: discovered.accepted.length });
    }
    state.queueRemaining = await remainingRows(client, state.lastCursor);
    state.status = state.queueRemaining === 0 ? 'complete' : 'paused';
    state.error = null;
    log(state.status, { queueRemaining: state.queueRemaining });
  } catch (error) {
    state.status = 'error';
    state.error = clean(error?.stack || error?.message || error);
    log('error', { error: state.error });
    process.exitCode = 1;
  } finally {
    await client.end();
    releaseLock();
  }
}

main();
