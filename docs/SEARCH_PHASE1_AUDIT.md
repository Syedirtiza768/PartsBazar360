# PartsBazar360 — Search Phase 1: Audit & Architecture

**Date:** 2026-08-01
**Scope:** buyer search, filtering, sorting, pagination, indexing, discovery.
**Method:** repository read-through + direct measurement against the **production** stack
(`ec2-3-217-241-37`, containers `partsbazar360-postgres-1`, `partsbazar360-opensearch-1`) and
live probes of `https://partsbazar360.com/api/search/parts`.

Everything numeric below was measured, not estimated. Nothing in this document is a projection.

Supersedes the planning half of [`SEARCH_OVERHAUL_AUDIT_AND_PLAN.md`](SEARCH_OVERHAUL_AUDIT_AND_PLAN.md)
(whose Stages 1–5 shipped — verified: `canonical_parts.max_result_window = 100000`,
`track_total_hits` present, multi-select filters and scoped facets present in
`opensearch.service.ts`). This document covers what that pass did **not** reach.

---

## 1. Current architecture

```
Buyer (Next.js 16, basePath /buyer, SSR)
  app/search/page.tsx ──► GET {INTERNAL_API_URL}/search/parts?…      (revalidate 30s
        │                                                             / no-store in vehicle mode)
        ├── FilterSidebar / FilterDrawer  — plain <a> links, no client filter state
        ├── SortSelect · PageSizeSelect · Pagination — URL params only
        └── HeroSearch ──► /search/suggest (200 ms debounce, AbortController, 60 s cache)

API (NestJS)  modules/search/
  search.controller.ts   GET /search/parts · /facets · /suggest · /parts/:id (+ enrichment, svg)
  opensearch.service.ts  browseParts · searchCompatibleParts · suggest · getFacets · indexPart
        │
        ├──► OpenSearch 2.11, single index `canonical_parts`, 1 shard, 273 MB
        └──► PostgreSQL 15 (Prisma) — canonical source of truth
```

**Frontend state model is sound and should be preserved.** Filters are anchors, the results page is
a server component, and all state lives in the URL. There is no client-held filter state, so the
classic "stuck filter" / stale-closure / race-condition failure mode is *structurally impossible*
on the results page. Suggestions already abort superseded requests. Sections 11–13 of the brief
are largely already satisfied on the client; the defects are in the **data and the query layer**.

---

## 2. Measured scale (production, 2026-08-01)

### PostgreSQL

| Table | Rows | Note |
|---|---:|---|
| `MvlVehicle` | 1,325,947 | eBay Motors vehicle list |
| `FitmentEvidence` | 774,399 | |
| `Fitment` | 513,066 | |
| `AuditEvent` | 437,933 | |
| `RawStagingListing` | 232,711 | |
| `SearchOutbox` | 202,375 | **198,129 DONE / 4,246 PENDING** |
| `Inventory` | 187,605 | |
| `SellerOffer` | 158,666 | 143,760 ACTIVE / 14,907 INACTIVE |
| `CanonicalPart` | 154,829 | 139,313 have ≥1 ACTIVE offer |
| `CatalogPartNumber` | 63,957 | 60,711 `BRAND_MPN` + 3,246 `OEM_CROSS_REFERENCE` |
| `VehicleConfiguration` | 28,531 | |
| `VehicleModel` | 3,175 | |
| `VehicleMake` | 94 | |
| `BrandAlias` · `VehicleMakeAlias` · `User` | **0** | |

### OpenSearch `canonical_parts`

125,859 docs · 4,289 deleted · 273 MB · 1 primary shard · `max_result_window` 100,000.

Field coverage across those 125,859 docs:

| Field | Docs populated | Coverage |
|---|---:|---:|
| `offers.sellerId` | 125,859 | 100 % |
| `oeNumbers` | 96,065 | 76 % |
| `imageUrls` | 68,395 | **54 %** |
| `normalizedPartNumbers` | 60,711 | **48 %** |
| `fitments` | 54,972 | 44 % |
| `interchangePartNumbers` | 3,246 | **2.6 %** |

---

## 3. Reproduced failures

All probes run against production, `limit=3`.

### 3.1 Part-number formatting equivalence is broken — **the brief's first requirement**

The brief states `8640112020`, `86401-12020`, `86401 12020`, `86401/12020` must be equivalent.

| Query | `total` | Correct part in results? |
|---|---:|---|
| `8640112020` | 3 | ✅ yes |
| `86401-12020` | 5 | ❌ **no** — returns FEBEST trailing rod `0125-141`, `5720212020`, `8941312020` |
| `86401 12020` | 5 | ❌ no — same wrong set |
| `86401/12020` | 5 | ❌ no — same wrong set |
| `86401` (partial) | **0** | ❌ no results at all |
| `A 221 820 02 64` (Mercedes' own OEM format) | **3,742** | ❌ no — correct part absent, 3.7 k of noise |
| `a2218200264` | 4 | ✅ yes |

### 3.2 No typo tolerance

| Query | `total` |
|---|---:|
| `alternator` | 424 |
| `altrenator` | **0** |

`suggest()` uses `fuzziness: AUTO`; `browseParts()` does not. Typo tolerance exists in the
dropdown and vanishes the moment the buyer presses Enter.

### 3.3 No synonyms / compound handling

| Query | `total` |
|---|---:|
| `tail light` | 983 |
| `taillight` | **22** |

Same intent, 45× difference in recall.

### 3.4 No query understanding

- `2019 toyota corolla lane camera` → **5,834 results**. The top 3 are correct, but recall is
  enormous because `minimum_should_match: 1` over an OR'd `multi_match` admits any document
  matching only `camera`, or only `2019`. Year, make and model are not extracted or used as
  filters — they are just tokens.
- `LH headlight` → **2,807 results**, top hits are a headlight *mounting support*, a headlight
  *bracket*, and a headlight *level-control switch*. `LH` (left-hand / driver side) is
  silently ignored: there is no side/position concept anywhere in the system.

---

## 4. Root causes

### RC-1 — `normalizedPartNumbers` is empty for 52 % of the catalogue **(causes 3.1)**

`browseParts` relies on one clause for formatting-insensitive matching:

```ts
should.push({ term: { 'normalizedPartNumbers.keyword': {
  value: normalizePartNumber(qq), boost: 60 } } });        // opensearch.service.ts
```

Sampling the indexed document for MPN `8640112020` (`2019 Toyota Corolla Lane Departure Camera`):

```json
{ "manufacturerPartNumber": "8640112020",
  "oeNumbers": ["8640112020"],
  "normalizedPartNumbers": [],          ← empty
  "interchangePartNumbers": [] }        ← empty
```

`indexPart()` derives `normalizedPartNumbers` **only from `CatalogPartNumber` rows**. There are
60,711 `BRAND_MPN` rows — exactly the 60,711 docs with the field populated. The 65,148
`SALVAGE_OEM` documents (the largest slice of the catalogue) have no `CatalogPartNumber` row, so
the boost-60 exact path is dead for them.

Bare `8640112020` still works, but **by accident**: the standard analyzer keeps it as one token so
`multi_match` on `manufacturerPartNumber^3` matches. Insert any separator and the standard analyzer
splits it into `86401` + `12020`, neither of which matches the single token `8640112020` — and the
normalized fallback that was designed to catch exactly this case is empty. Hence the wrong results.

`A 221 820 02 64` fails the same way, then matches `820` across thousands of unrelated documents.

### RC-2 — the live index is 100 % dynamically mapped

`indexMapping()` in `opensearch.service.ts` declares a careful explicit mapping — `partType: keyword`,
`offers: nested`, `normalizedPartNumbers: keyword`. **None of it is applied.** `ensureIndex()` only
sends the mapping in the `indices.create` branch; the index already existed (created by
`tmp/reindex-full.js`), so every field is dynamic `text` + `.keyword`:

```
brand→text  category→text  makes→text  partType→text  normalizedPartNumbers→text
offers→object (NOT nested)  oeNumbers→text  sourceTags→text
```

Consequences: no custom analyzer, so no synonyms (RC-3), no ASCII folding, no edge-ngram prefix
matching, no part-number normalizer at analysis time. `offers` being `object` rather than `nested`
also means offer sub-fields cross-contaminate across offers of the same part — condition/price/
seller facets cannot be made correct on this index.

**This is the blocking constraint: none of §4, §5, §7 of the brief can be delivered on the current
index. A new versioned index and an alias swap are unavoidable.**

### RC-3 — no analysis-time synonyms or fuzziness in `browseParts` (causes 3.2, 3.3)

### RC-4 — no query-understanding layer (causes 3.4)

The raw string goes straight into `multi_match`. Nothing extracts year, make, model, side,
condition, or part-number shape.

### RC-5 — the taxonomy that facets are built on is not a taxonomy

```
category : General 55,680 · Body 15,313 · Engine 9,043 · Suspension 8,460 · Brakes 6,955 ·
           Electrical 5,356 · Interior 4,590 · Wheels 3,068 · Cooling 2,093 · Transmission 1,917 ·
           MERCEDES 1,806 · BMW 1,309 · VW/AUDI 1,104 · TOYOTA 1,099 · LKW-MERCEDES 997
partType : SALVAGE_OEM 65,148 · GENUINE_OEM 42,355 · AFTERMARKET 16,335 · UNCLASSIFIED 2,021
```

- `category` is 44 % `General`, and its vocabulary is **polluted with make names**. Brand and
  category are conflated in one dimension.
- `partType` holds **provenance, not part type**. There is no "Lane Departure Camera",
  "Headlight", "Control Arm" dimension anywhere in the system — the single most important
  facet for an automotive catalogue does not exist.
- Condition exists only inside `offers` and is `USED` (123,294) / `NEW` (2,566) — no
  remanufactured/refurbished, and it is not exposed as a filter at all.

### RC-6 — fitment granularity is year/make/model only

All 28,531 `VehicleConfiguration` rows carry **empty** `trim`, `engine`, `transmission`,
`drivetrain`, and `market = GLOBAL`. The brief's trim/engine/transmission/drivetrain filters
cannot be answered honestly from current data. Building those controls now would violate
"never present uncertain compatibility as confirmed".

### RC-7 — indexing is stale and lossy

- 139,313 parts have an active offer; 125,859 documents exist → **≈13,454 buyer-visible parts are
  not searchable at all**.
- `SearchOutbox` has **4,246 PENDING rows**, oldest 2026-07-31 12:54. There is **no consumer**:
  `grep -rn searchOutbox apps/api/src` returns only two lines in `merchant/uploads.service.ts`
  (one `create`, one `updateMany`). The table is written and closed inline by the upload path;
  nothing else ever drains it.
- `indexPart` is not called on price change, inventory change, fitment change, or seller
  suspension — the most volatile fields drift.

### RC-8 — supersession / interchange is barely modelled

`CatalogPartNumber.numberType` only ever holds `BRAND_MPN` or `OEM_CROSS_REFERENCE`. There is no
superseded-number type, no direction, no confidence, no source, no verification status, and no
audit history. Brief §10 (bidirectional relationships, replacement classification) is unimplemented.

---

## 5. Search-engine decision

**Recommendation: keep OpenSearch. Do not add a new engine.**

| Option | Verdict |
|---|---|
| PostgreSQL FTS + `pg_trgm` | Would handle 155 k parts, and `pg_trgm` would fix part-number fuzziness well. But facet counts across 8+ dimensions with correct exclusion logic mean one aggregate query per dimension per request; and the brief targets 1 M+ listings. Rejected as the primary engine — **retained as the degraded-mode fallback** (§22). |
| Elasticsearch / Meilisearch / Typesense | Each would work. None solves a problem OpenSearch cannot: every failure in §3 is caused by an empty field, a missing analyzer, or a missing parser — not by engine capability. Migrating would add an operational surface and cost while leaving RC-1 and RC-4 untouched. Rejected. |
| **OpenSearch, fixed** | Already deployed, already integrated, 273 MB at 126 k docs → ~2 GB at 1 M. Supports synonym graphs, edge-ngram, normalizers, nested facets, `search_after`, alias swaps. **Selected.** |

PostgreSQL remains the canonical source of truth; the index stays a derived artefact that can be
rebuilt from scratch at any time.

---

## 6. Target architecture

```
                     ┌─ QueryUnderstanding (deterministic, no AI) ─┐
   raw query ───────►│ part-number shapes · year/range · make ·    │───► structured query
                     │ model · side · condition · synonyms         │
                     └────────────────────────────────────────────┘
                                        │
                                        ▼
                     ┌─ RelevanceBuilder (configurable weights) ──┐
                     │ exact OEM 100 › interchange 80 › SKU 70 ›  │
                     │ normalized 60 › fitment 40 › phrase 30 ›   │
                     │ prefix 15 › token 10 › synonym 6 › fuzzy 3 │
                     └────────────────────────────────────────────┘
                                        │
   alias `parts_search` ────────────────▼──────► canonical_parts_v2  (analyzers, nested offers)
        ▲                                                   ▲
        │ atomic swap                                       │ bulk reindex from Postgres
   IndexAdmin ──────────────────────────────────────────────┘
```

Key elements:

1. **Versioned index behind an alias.** App reads/writes `parts_search`; physical indices are
   `canonical_parts_v2`, `_v3`, … Reindex builds the new one, then swaps atomically. Gives
   zero-downtime reindexing and instant rollback (§19).
2. **Analyzers.** `pb_text` (lowercase + asciifolding + automotive synonym graph + light stemming);
   `pb_partnum` (strip every non-alphanumeric to a single token) plus a `pb_partnum_prefix`
   edge-ngram subfield for partial numbers.
3. **`searchNumbers` — one field, every number.** Populated from `manufacturerPartNumber`,
   `oeNumbers`, *and* `CatalogPartNumber` rows, normalized and de-duplicated, with the
   original values retained separately for display. Fixes RC-1 for 100 % of documents.
4. **Deterministic query understanding.** Regex/dictionary parsing only. AI is not in the
   request path (brief §6, §29).
5. **Nested offers** so condition/price/seller facets can be correct.

### Data-model changes

| Change | Why |
|---|---|
| `CatalogPartNumber.numberType` gains `SUPERSEDED`, `INTERCHANGE`, `AFTERMARKET_EQUIV`; add `relationshipType`, `confidence`, `verificationStatus`, `sourceRef` | RC-8, brief §10 |
| New `PartTypeTaxonomy` + `CanonicalPart.partTypeId` | RC-5 — the missing part-type dimension |
| `CanonicalPart.side` / `position` (nullable enum) | brief §11, §6 |
| `SearchEvent` table | brief §20 |
| `SearchSynonym` table (versioned, category-aware) | brief §7 |
| Backfill `BrandAlias` / `VehicleMakeAlias` | RC-5 |
| `VehicleConfiguration.trim/engine/drivetrain` left **unused by filters** until populated | RC-6 — do not ship dishonest controls |

### Migration plan

1. Ship the query-understanding + normalization module (pure functions, no infra impact). ✔ safe
2. Build `canonical_parts_v2` alongside the live index. No user impact.
3. Bulk reindex from PostgreSQL into v2; verify doc counts and spot-check the §3 probes.
4. Swap the alias. Rollback = swap back (seconds).
5. Drain `SearchOutbox` with a real worker; add the reconcile job.
6. Additive Prisma migrations for the tables above.
7. Frontend consumes the extended contract behind a feature flag.

### Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Reindex produces a worse ranking than today | High | v2 built and probed *before* the alias swap; §3 probe table is the acceptance gate |
| Synonym list over-expands recall | Medium | Category-scoped, versioned, unit-tested; synonym matches score below token matches |
| Reindex load on a single-shard cluster | Medium | Throttled bulk, off-peak, `refresh_interval: -1` during build |
| 13,454 missing parts turn out to be intentionally excluded | Medium | Reconcile job reports before it writes; sample reviewed first |
| Prefix ngrams grow the index | Low | `min_gram 3 / max_gram 12`, part-number fields only; measured before/after |

---

## 7. Definition of done for Phase 1

- [x] Architecture, data flow, and query path documented from the code.
- [x] Production scale measured (Postgres + OpenSearch).
- [x] Every failure in the brief's §2 examples reproduced or confirmed working, with numbers.
- [x] Root cause established for each failure, traced to a specific line or a specific empty field.
- [x] Engine comparison with a justified decision to **not** add a new engine.
- [x] Data-model changes, migration order, and rollback identified.
- [x] Risks registered with mitigations.

**No production change has been made.** The alias swap and the reindex are production-impacting and
require explicit approval before execution.
