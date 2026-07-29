# Buyer Marketplace — Search, Filtering & Pagination Overhaul

Audit of the existing system + staged implementation plan. Grounded in the code as it exists at `F:\apps\PartsBazar360` (Next.js 16 buyer app, NestJS API, Prisma 7, OpenSearch, Redis/BullMQ).

Reference: https://partsbazar360.com/buyer/ · spec document id `68427`.

---

## 1. Existing search-system audit

### 1.1 Architecture in place

- **Buyer app** (`apps/buyer-marketplace`, Next.js 16, React 19, basePath `/buyer`, `trailingSlash: true`):
  - `app/search/page.tsx` — server component, fetches `/search/parts` + `/search/facets`, renders grid + `Pagination` + `FilterSidebar`/`FilterDrawer` + `SortSelect`. `PAGE_SIZE = 24` (hardcoded). Browse cached `revalidate: 30s`; vehicle/fitment search `no-store`.
  - `app/page.tsx` — homepage: `HeroSearch` (client autocomplete), `VehiclePicker`, featured newest 8, category + brand facets.
  - `components/HeroSearch.tsx` + `lib/use-search-suggestions.ts` — debounced (200ms) autocomplete against `/search/suggest`, client cache 60s, keyboard nav, recents. Aborts stale requests.
  - `components/FilterSidebar.tsx` — filter links as anchors (JS-optional, crawlable). `buildHref()` resets page on filter change. `ActiveFilterChips`.
  - `components/Pagination.tsx` — windowed `1 … p-1 p p+1 … N`, prev/next, hides non-adjacent on `<xs`.
  - `components/SortSelect.tsx` — `newest | price_asc | price_desc`.
  - `components/ProductCard.tsx` — image, fitment badge (garage-aware), condition/source, title, OE/MPN, seller, price; interchange-match label; enrichment prewarm.
  - `lib/fitment.ts` — `verified | likely | check | incompatible | universal | unknown` states; A/B evidence ≥0.8 = verified.
  - `lib/format.ts` — buyer-visible offer filtering (drops `seed-febest-inventory-supplier`, non-ACTIVE, non-positive price).
- **API** (`apps/api`, NestJS):
  - `modules/search/search.controller.ts` — `GET /search/parts` (browse or fitment-first), `/search/facets`, `/search/suggest`, `/search/parts/:id` (PDP), enrichment prewarm, infographic/diagram. `limit` capped at 200.
  - `modules/search/opensearch.service.ts` — single index `canonical_parts`. `browseParts` (keyword + filters + sort + `from/size`), `searchCompatibleParts` (fitment-first, `track_total_hits:true`), `suggest`, `getFacets`, `indexPart`.
  - `modules/search/buyer-visible-offers.util.ts` — re-sanitizes offers at read time (defense-in-depth vs stale OS docs).
  - `modules/search/buyer-cache.service.ts` — on-demand Next.js ISR revalidation (`revalidateTag part:<id>`), not a read-through cache.
  - `modules/catalog-import/part-normalization.util.ts` — `normalizePartNumber` (NFKC → upper → strip non-alphanumeric), `normalizeMasterName` (for brand/make keys).
- **Data model (Prisma)**: `CanonicalPart`, `SellerOffer` (the listing/offer table), `CatalogPartNumber`, `BrandMaster`+`BrandAlias`, `VehicleMake`+`VehicleMakeAlias`, `VehicleModel/Generation/Configuration`, `Fitment` (evidenceLevel A–F, confidence), `Inventory`+`Warehouse`, `SalvageUnit`+`DonorVehicle`, `MvlVehicle` (eBay MVL), `SearchOutbox`.

### 1.2 Identified problems (with severity)

| # | Problem | Where | Severity |
|---|---|---|---|
| P1 | **10,000-listing cap.** OpenSearch default `max_result_window = 10000` is never overridden. Deep pages (`from+size > 10000`) throw → swallowed → **empty results**; `total` is capped at 10,000 (no `track_total_hits:true` in `browseParts`). Buyer cannot reach listings past ~page 416 (24/page). **This is the explicit "go beyond 10000, include all active" blocker.** | `opensearch.service.ts` (no `ensureIndex`, no settings) + `tmp/reindex-full.js` (no `max_result_window`) | **Critical** |
| P2 | Index never created/mapped by the app. `onModuleInit` only builds the client; the index + mapping come from a manual script (`tmp/reindex-full.js`) whose mapping omits `fitmentConfidence`, `listingUrl`, `ebayItemId`, and explicit nested `offers.*` subfields (relies on dynamic mapping). | `opensearch.service.ts:12-17` | High |
| P3 | `indexPart` not invoked on price change, fitment change, inventory change, or seller suspension — only on spreadsheet commit, RealTrack ingest (unless `SKIP_OS_INDEX_ON_INGEST`), and offer deactivation. Search can go stale on the most volatile fields (price/stock). | `uploads.service.ts:1296`, `ingestion.processor.ts:814,928` | High |
| P4 | Filters are **single-select toggles**, no multi-select within a facet (spec wants OR within facet). | `FilterSidebar.tsx` | High |
| P5 | **No facet counts beside filter options** (comment admits counts would be "contradictory" because `/search/facets` is computed over the whole corpus, not the current filtered set). Spec requires post-filter counts that recalculate. | `search.controller.ts:147`, `opensearch.service.ts:485` | High |
| P6 | Sort lacks **relevance**; default is `newest`. Spec: default should be relevance, with exact part-number/fitment first. | `SortSelect.tsx`, `opensearch.service.ts:294` | High |
| P7 | Pagination has no **result-range text** ("1–24 of 386"), no explicit first/last, no **page-size selector** (24/48/72). `PAGE_SIZE` hardcoded. | `app/search/page.tsx:21`, `Pagination.tsx` | Medium |
| P8 | Brand normalization is partial: `BrandMaster.canonicalName` is set via `normalizeMasterName`, but `BrandAlias` is never populated by ingestion. Vehicle makes are **not normalized for storage** — keyed by raw `name`, so `Toyota`/`TOYOTA`/`Land Rover`/`LAND ROVER` create separate `VehicleMake` rows; `VehicleMakeAlias` unused. Two parallel hardcoded make-alias tables exist for parsing only. | `uploads.service.ts:746`, `mvl-fitment.service.ts:200`, `ingestion.processor.ts:852` | High |
| P9 | No synonym/typo layer for descriptive queries (spec §7). `suggest` uses `fuzziness:AUTO` (good) but `browseParts` keyword search does not. | `opensearch.service.ts:240` | Medium |
| P10 | Zero-result page is decent (source-request + interchange toggle hint) but lacks "relax filters / similar part numbers / remove vehicle" structured recovery (spec §15). | `app/search/page.tsx:242` | Medium |
| P11 | No analytics events for search quality (zero-result rate, reformulation, CTR) (spec §21). | — | Medium |
| P12 | `SearchOutbox` exists but the upload path closes rows inline (no async worker) — so reindex-on-change is synchronous and limited to upload/deactivate. | `uploads.service.ts:1286,1339` | Medium |
| P13 | SEO: `searchCanonical` ignores `make`/`partType` and doesn't dedupe param ordering; deep pages noindexed (good). No product/JSON-LD on listing pages. | `seo.ts:30` | Medium |
| P14 | Fitment classification on cards is good (`verified/likely/check/unknown`), but browse results are not tagged with fitment confidence for a selected vehicle unless vehicle mode is on. | `ProductCard.tsx`, `fitment.ts` | Low |

### 1.3 What already works well (do not break)

- Vehicle-first fitment search with A/B-evidence gating; persistent garage context across pages.
- Buyer-visibility sanitization at index time AND read time (double defense).
- Interchange-number matching with buyer-facing toggle + "matched via interchange" labelling.
- JS-optional, crawlable filter links; sensible noindex rules.
- Autocomplete with debounce, abort, cache, keyboard nav, recents.
- Part-number normalization at index and query time (`normalizePartNumber`) — formatting-insensitive exact match already works.

---

## 2. Proposed architecture & strategy

- Keep OpenSearch as the search engine (already integrated). Add a **search-service abstraction boundary** by centralizing all query construction in `OpenSearchService` and exposing a stable `SearchService`-shaped interface so a future swap (Meilisearch/Typesense) is mechanical. (Pragmatic: the controller already only talks to `OpenSearchService`; we formalize the contract.)
- **Hybrid pagination** (spec §12): page-based URLs for SEO/direct nav (1…N) + `track_total_hits:true` + raised `max_result_window` for accurate totals and deep reach; expose an optional `search_after` cursor in the API contract for future >100k catalogs.
- **Post-filter facets**: compute brand/category/make/condition aggregations scoped to the *other* active filters so counts are always consistent with the visible result set.
- **Normalization**: keep `normalizePartNumber`; add `normalizeMasterName`-based canonicalization for makes at index time and a backfill alias step; do not destroy original seller values.
- **Ranking**: weighted `should` clauses (exact part number → MPN → interchange → title → fuzzy) + secondary commercial signals via `function_score`, never overriding exact-number/fitment relevance.

---

## 3. Staged implementation plan

> Each stage is independently shippable and testable. Stages 1–5 are implemented in this pass. Stages 6+ are documented for the next pass.

### Stage 1 — Remove the 10k cap (core; explicit request)
- `opensearch.service.ts`: add `ensureIndex()` in `onModuleInit()` that (a) creates the index with explicit settings + complete mapping if missing, (b) `PUT _settings` to raise `index.max_result_window` (`OPENSEARCH_MAX_RESULT_WINDOW`, default `100000`), (c) `PUT _mapping` for fields the manual mapping omitted.
- `browseParts`: add `track_total_hits: true`; clamp `from` to the window; read `total` accurately (honor `relation: "gte"`).
- `searchCompatibleParts`: clamp `from`; accurate total already on.
- **Impact**: total reflects ALL active listings; every page is reachable (up to 100k by default, env-tunable). No data migration required.

### Stage 2 — Accurate totals + cursor contract in the controller
- `search.controller.ts`: validate/bound `page`, `limit` (allow 24/48/72, cap 200), pass through; surface `totalRelation`/optional `nextCursor` in the response shape (forward-compatible).
- Keep response backwards-compatible (`items/total/page/limit` unchanged).

### Stage 3 — Pagination UX
- `app/search/page.tsx`: add result-range line (`1–24 of 386 results`), read `pageSize` from URL (24/48/72, default 24), pass to API.
- `components/Pagination.tsx`: add first/last buttons, keep windowed list; accessible `aria-label`s.
- New `components/PageSizeSelect.tsx` (or extend `SortSelect`) — persisted in URL, resets page on change.

### Stage 4 — Sort options
- `SortSelect.tsx`: add `relevance` (first). `browseParts`: `relevance` → `_score` (weighted should) for keyword, falls back to `newest` for no-query browse; keep `price_asc/desc`, `newest`.
- Default sort: `relevance` when `q` present else `newest`.

### Stage 5 — Multi-select filters + dynamic counts
- Backend: accept `category`/`brand`/`make`/`partType`/`condition` as repeated/comma params → `terms` filters (OR within facet, AND across). Return post-filter facet aggregations scoped to the other filters.
- Frontend: rewrite `FilterSections` to multi-select checkboxes (add/remove from comma-list), show counts, "show more"/searchable long lists, "clear all", total active count. Update `buildHref` + `ActiveFilterChips` for arrays. Backward-compatible with single-value URLs.

### Stage 6 — (next pass) Normalization hardening + reindex
- Populate `BrandAlias`/`VehicleMakeAlias` at ingest; index `canonicalMake`; update `reindex-oe-numbers.mjs` + a `reindex-full` script that uses `ensureIndex`.

### Stage 7+ — (next pass) Synonyms/typos, zero-result recovery, analytics, accessibility audit, automated tests, JSON-LD.

---

## 4. Per-change impact register (for the changes in this pass)

| Change | Existing behaviour | Problem | Solution | Files | DB impact | API impact | User impact | Perf impact | Risk | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| ensureIndex + max_result_window | index relies on manual script; default 10k window | P1/P2 | app-managed index + raised window | `opensearch.service.ts` | none (OS setting) | none | all listings reachable | deep offset slower but bounded; counts accurate | Low (additive; idempotent) | revert setting; restart API |
| track_total_hits:true | total capped at 10k | P1 | accurate count | `opensearch.service.ts` | none | `total` now accurate (>10k) | correct totals | negligible | Low | revert |
| page-size param | fixed 24 | P7 | 24/48/72 in URL | `search/page.tsx`, `PageSizeSelect`, `opensearch.service.ts` | none | accepts `pageSize` | choice | fewer round-trips at 72 | Low | revert |
| result-range + first/last | missing | P7 | UI additions | `Pagination.tsx`, `search/page.tsx` | none | none | orientation | none | Low | revert |
| relevance sort | newest default | P6 | weighted `_score` | `SortSelect.tsx`, `opensearch.service.ts` | none | `sort=relevance` | better matches | none | Low | revert |
| multi-select + counts | single-select, no counts | P4/P5 | `terms` + post-filter aggs | `FilterSidebar.tsx`, `search.controller.ts`, `opensearch.service.ts`, `types.ts` | none | array filters; facets scoped | accurate filters | 1 extra agg query | Medium | revert (single-value URLs still work) |

---

## 5. Definition of Done (for this pass)

- [x] Exact part-number search still surfaces exact matches first (unchanged path).
- [x] `track_total_hits:true` → total reflects all active listings beyond 10k.
- [x] Deep pages return results (no empty-page cliff at 10k).
- [x] Pagination shows range, first/last, and selectable page size.
- [x] Default sort is relevance for keyword; existing sorts preserved.
- [x] Filters are multi-select with scoped counts; URL state survives refresh.
- [x] Existing cart, seller, listing, currency, fitment flows untouched.
- [x] TypeScript strict; lint clean.
- [ ] (next pass) Synonyms, analytics, tests, JSON-LD.

---

## 6. Deployment & rollback (requires approval — production-impacting)

1. Merge code; deploy API + buyer-marketplace.
2. On API boot, `ensureIndex()` raises `max_result_window` on the live `canonical_parts` index (idempotent; no reindex needed for the cap fix).
3. (Optional, for stale price/stock fields) run a full reindex via the existing `tmp/reindex-full.js` or a new `ensureIndex`-aware script — **only if** P3 staleness must be closed now; otherwise defer to Stage 6.
4. Verify: `GET /search/parts?limit=24&page=450` returns items (was empty); `/search/facets` counts scoped.
5. **Rollback**: revert deploy; `PUT canonical_parts/_settings {"index.max_result_window": 10000}` to restore prior behaviour (search still works, just capped at 10k again).
