/**
 * Backfill normalized primary part numbers onto the existing search index.
 *
 * Why: the ingestion fix indexes each part's OE numbers as normalized primary
 * part numbers (`normalizedPartNumbers`), so a formatting-insensitive exact
 * match (`normalizedPartNumbers.keyword`) resolves the part — not only the
 * fuzzy `oeNumbers` multi_match. That fix only affects newly-ingested parts;
 * this script applies the same derivation to parts already in the index.
 *
 * Safety: this is a PARTIAL update. For each doc it sets only
 * `normalizedPartNumbers` and `partNumbers`, both derived from the doc's own
 * existing `oeNumbers` (already in the index). It never touches offers,
 * fitments, minPrice, or any other field, so it cannot degrade search results.
 * It is idempotent — re-running sets identical values — so a failed run can be
 * restarted from the beginning. `interchangePartNumbers` is intentionally left
 * absent: OE numbers are primary, not cross-references.
 *
 * No dependencies — uses global fetch (Node 18+). Run inside a container that
 * can reach OpenSearch, e.g.:
 *   docker cp apps/api/reindex-oe-numbers.mjs partsbazar360-api-1:/tmp/
 *   docker exec partsbazar360-api-1 node /tmp/reindex-oe-numbers.mjs
 *
 * Env:
 *   OPENSEARCH_URL  default http://opensearch:9200
 *   INDEX           default canonical_parts
 *   BATCH           scroll page size, default 1000
 *   DRY_RUN         "1" to log sample updates and write nothing
 *   LIMIT           stop after N docs (for a test slice); 0 = all
 */

const OS = process.env.OPENSEARCH_URL || "http://opensearch:9200";
const INDEX = process.env.INDEX || "canonical_parts";
const BATCH = parseInt(process.env.BATCH || "1000", 10);
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = parseInt(process.env.LIMIT || "0", 10);

// Must stay identical to normalizePartNumber() in
// apps/api/src/modules/catalog-import/part-normalization.util.ts so that
// index-time and query-time normalization agree.
const normalize = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

async function os(path, { method = "GET", body } = {}) {
  const res = await fetch(`${OS}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

/** Build the partial update doc for one hit, or null if it has no OE numbers. */
function buildUpdate(oeNumbers) {
  const oes = (oeNumbers || []).filter((n) => n && String(n).trim());
  if (oes.length === 0) return null;
  const partNumbers = [];
  const normalized = [];
  const seen = new Set();
  for (const oe of oes) {
    const n = normalize(oe);
    if (!n) continue;
    partNumbers.push({ displayNumber: oe, normalizedNumber: n, numberType: "OEM" });
    if (!seen.has(n)) {
      seen.add(n);
      normalized.push(n);
    }
  }
  if (normalized.length === 0) return null;
  return { partNumbers, normalizedPartNumbers: normalized };
}

async function bulkUpdate(ops) {
  if (ops.length === 0) return { updated: 0, errors: [] };
  const ndjson =
    ops
      .map(({ id, doc }) => `${JSON.stringify({ update: { _id: id } })}\n${JSON.stringify({ doc })}`)
      .join("\n") + "\n";
  const res = await os(`/${INDEX}/_bulk?refresh=false`, { method: "POST", body: ndjson });
  const errors = [];
  if (res.errors) {
    for (const item of res.items) {
      const r = item.update;
      if (r && r.error) errors.push({ id: r._id, error: r.error.type });
    }
  }
  return { updated: ops.length - errors.length, errors };
}

async function main() {
  const started = Date.now();
  console.log(
    `[reindex-oe] index=${INDEX} os=${OS} batch=${BATCH} dryRun=${DRY_RUN} limit=${LIMIT || "all"}`,
  );

  const total = (await os(`/${INDEX}/_count`)).count;
  console.log(`[reindex-oe] ${total} docs in index`);

  let scrollId = null;
  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  const allErrors = [];
  let dryShown = 0;

  let page = await os(`/${INDEX}/_search?scroll=2m`, {
    method: "POST",
    body: { size: BATCH, _source: ["oeNumbers"], query: { match_all: {} } },
  });
  scrollId = page._scroll_id;

  try {
    while (page.hits.hits.length > 0) {
      const ops = [];
      for (const hit of page.hits.hits) {
        scanned++;
        const doc = buildUpdate(hit._source.oeNumbers);
        if (!doc) continue;
        eligible++;
        if (DRY_RUN) {
          if (dryShown < 8) {
            console.log(`  [dry] ${hit._id} oe=${JSON.stringify(hit._source.oeNumbers)} -> normalized=${JSON.stringify(doc.normalizedPartNumbers)}`);
            dryShown++;
          }
        } else {
          ops.push({ id: hit._id, doc });
        }
        if (LIMIT && scanned >= LIMIT) break;
      }

      if (!DRY_RUN && ops.length > 0) {
        const r = await bulkUpdate(ops);
        updated += r.updated;
        if (r.errors.length) {
          allErrors.push(...r.errors);
          console.warn(`  [warn] ${r.errors.length} bulk errors in this batch (first: ${r.errors[0].error})`);
        }
      }

      if (scanned % (BATCH * 10) < BATCH) {
        const pct = ((scanned / total) * 100).toFixed(1);
        const rate = Math.round(scanned / ((Date.now() - started) / 1000));
        console.log(`[reindex-oe] scanned ${scanned}/${total} (${pct}%) eligible=${eligible} updated=${updated} ~${rate}/s`);
      }

      if (LIMIT && scanned >= LIMIT) break;

      page = await os(`/_search/scroll`, {
        method: "POST",
        body: { scroll: "2m", scroll_id: scrollId },
      });
      scrollId = page._scroll_id;
    }
  } finally {
    if (scrollId) {
      try {
        await os(`/_search/scroll`, { method: "DELETE", body: { scroll_id: [scrollId] } });
      } catch {
        /* best effort */
      }
    }
  }

  if (!DRY_RUN) {
    console.log(`[reindex-oe] refreshing index...`);
    await os(`/${INDEX}/_refresh`, { method: "POST" });
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `[reindex-oe] DONE in ${secs}s — scanned=${scanned} eligible=${eligible} updated=${updated} errors=${allErrors.length}${DRY_RUN ? " (DRY RUN, nothing written)" : ""}`,
  );
  if (allErrors.length) {
    console.log(`[reindex-oe] sample errors:`, allErrors.slice(0, 5));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[reindex-oe] FATAL", e);
  process.exit(1);
});
