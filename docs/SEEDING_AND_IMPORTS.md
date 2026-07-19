# Marketplace seeding and seller imports

## Import modes

Seller uploads support two commit modes:

- `IMMEDIATE` (seed default): stage + write catalog/offers/inventory in one pass.
- `STAGED` (seller portal default): normalize, classify, and match into preview rows; call `POST /merchant/uploads/:jobId/commit` after review.

Preview payload is available at `GET /merchant/uploads/:jobId/preview`. Mapping defaults can be updated with `PUT /merchant/uploads/:jobId/mapping`.

Shared vocabulary for part types, fitment statuses, and review queues lives in `@repo/catalog-contracts` so API, buyer, seller, and admin stay aligned.

See `docs/IMPLEMENTATION_PLAN.md` for the full linked rollout.

## What is implemented

`npm run seed:marketplace --workspace api` is the single repeatable entry point for RealTrack/eBay stores and seller workbooks. It creates a seller per source account, keeps seller identity separate from product brand, fetches every configured listing unless a development limit is set, requests the store-scoped listing detail, and reuses the production spreadsheet upload service for `.xlsx` and `.csv` files.

The importer detects the supplied DXB-EXW and FEBEST shapes as templates, but the parser itself is header-driven. Original rows are retained in `SourceRecord`; normalization output and confidence are retained separately.

## Required setup

1. Apply Prisma migrations and regenerate the client.
2. Configure PostgreSQL, Redis, OpenSearch, and the RealTrack credentials using `apps/api/.env.example`.
3. Set `SEED_DXB_FILE` and `SEED_FEBEST_FILE` to readable local paths.
4. Confirm the FEBEST price currency and logistics units with `SEED_FEBEST_CURRENCY`, `SEED_FEBEST_WEIGHT_UNIT`, and `SEED_FEBEST_DIMENSION_UNIT`. If they are omitted, rows import for review and are not silently treated as verified live inventory.
5. Run `npm run seed:marketplace --workspace api`.

An empty `SEED_EBAY_LISTING_LIMIT` means all listings. The report path is controlled by `SEED_REPORT_PATH`.

## RealTrack limitations found in the supplied API contract

The Published Listings Reader can access the paginated list and store-scoped detail routes. It does not have `stores.view`, so it cannot discover stores through `GET /api/stores`; the checked-in store manifest is therefore an explicit integration manifest and can be overridden by `REALTRACK_STORE_MANIFEST_JSON`.

The supplied contract documents no separate compatibility endpoint. The detail payload is imported when it contains structured compatibility, but complete eBay Motors fitment cannot be claimed when the mirror omits it. Those listings remain seller/platform-declared or unverified rather than receiving a verified-fit state. Expanding the RealTrack reader contract is required to guarantee every compatibility row.

## Adding a future seller file

1. Upload the workbook through `POST /merchant/uploads` or configure it as a seed source.
2. The parser detects the header row and maps recognized aliases without changing original values.
3. Add new header aliases in `spreadsheet-parser.service.ts` only when a new source uses genuinely new terminology.
4. Add seller-specific defaults through request fields or configuration; do not infer seller identity from the product brand column.
5. Add a parser fixture/test for compound values, zero stock, currency, units, and any new warehouse columns.

## Idempotency keys

- Seller source: source platform + external account ID.
- eBay staging listing: RealTrack source listing ID.
- Spreadsheet file: seller + SHA-256 file checksum.
- Spreadsheet offer/source row: seller + file checksum + sheet + row number.
- Catalog identity: brand namespace + normalized manufacturer part number, with review blockers for ambiguous brands.
- Inventory: warehouse + offer.
- Offer price: offer + currency.
- OEM link: product + type + normalized number + issuer make/group.

Zero stock remains zero. OEM cross-references remain searchable evidence and never create verified vehicle fitment by themselves.

## Interchange (cross-reference) search: data and reindex

Search matches interchange / analogue numbers by default so a superseded or cross-reference part number resolves to the part without the buyer knowing the term "interchange". A `?includeInterchange=false` query, or the buyer-facing toggle, restricts matching to the part's own primary identity numbers.

This behaviour is **live in code but dormant until the search index carries the data.** Two conditions must both hold, and neither is done by deploying the code alone.

### 1. Cross-reference data must exist in `CatalogPartNumber`

Interchange numbers are `CatalogPartNumber` rows with `numberType = 'OEM_CROSS_REFERENCE'`. They are created only by the seller-upload / seed path (`uploads.service.ts`), from the OEM-reference columns of a workbook. Running `npm run seed:marketplace --workspace api` against sources that carry those columns populates them.

Parts brought in through the RealTrack/eBay ingestion path (`ingestion.processor.ts`) do **not** currently receive cross-reference rows, and — see the known gap below — are not indexed with them either. A deployed index built only from ingestion therefore has no interchange data, which is the expected empty state, not a fault.

### 2. The search index must be re-populated with the interchange field

The index (`canonical_parts`) uses OpenSearch **dynamic mapping** — there is no explicit mapping or index template to migrate. The `interchangePartNumbers` field, and its `.keyword` sub-field, are created automatically the first time a document carrying the field is indexed. No mapping change or index recreation is required; only re-indexing documents that now carry the field.

`indexPart` (in `opensearch.service.ts`) writes the field, splitting each part's `partNumbers` by role:

- `normalizedPartNumbers` — primary identity only (everything except `OEM_CROSS_REFERENCE`); a match here is an exact-part match.
- `interchangePartNumbers` — `OEM_CROSS_REFERENCE` only; a match here alone is reported as `matchedVia: "interchange"`.

For the split to be non-empty, the object passed to `indexPart` must include a `partNumbers` array containing the `OEM_CROSS_REFERENCE` rows. The seller-upload path already does this; the ingestion path does not (see the gap below).

There is **no standalone reindex command in the repo.** Two ways to re-populate:

1. **Re-run the seed/upload.** `npm run seed:marketplace --workspace api` re-imports through `uploads.service.ts`, which re-indexes each affected part with its `partNumbers`. Sufficient when the affected parts come from seed/upload sources.
2. **A one-off reindex over existing parts.** For parts already in the catalog that will not be re-imported, iterate `CanonicalPart` with its `partNumbers` relation and call `searchService.indexPart` per part, mapping each `CatalogPartNumber` into the `partNumbers` array (`displayNumber`, `normalizedNumber`, `numberType`). No such script exists yet; it must be written. It reuses the existing `indexPart` — no new index or mapping work.

### Verifying it worked

Interchange matching is not observable until both steps above are complete; against an unpopulated index the query is a no-op (matching an absent field yields no extra hits), which is why the code is safe to ship ahead of the data.

Once populated, confirm end to end by searching a known `OEM_CROSS_REFERENCE` number that is **not** the part's own primary number:

```
GET /api/search/parts?q=<a-known-interchange-number>
```

The part should appear, and its result item should carry `matchedVia: "interchange"` and `matchedNumber: "<the-number>"`. Repeating with `&includeInterchange=false` should drop that hit. The buyer UI renders the `matchedVia` result as an "Interchange match" badge, and a part-number search that returns nothing routes to the sourcing flow.

### Ingestion path: primary numbers indexed; interchange still needs a source

`ingestion.processor.ts` now builds a `partNumbers` array for `indexPart` from the part's OE numbers (`canonicalPart.oeNumbers`), each entry typed `OEM` with `normalizedNumber = normalizePartNumber(oe)` — the same normalization the query uses. Ingested parts are therefore exact-matchable by a normalized OE number (the `normalizedPartNumbers.keyword` term clause), not only through the fuzzy `oeNumbers` multi_match, so formatting variants like `4g0-867-409` resolve the part. This takes effect on the next reindex/re-ingest (dynamic mapping; no mapping change).

Interchange (`OEM_CROSS_REFERENCE`) search for ingested parts remains inactive for a data reason, not a code one: the RealTrack/eBay feed carries no cross-reference numbers, and ingestion creates no `CatalogPartNumber` rows. Populating them needs a cross-reference source (a supplier interchange table, or an enrichment step that writes `OEM_CROSS_REFERENCE` rows for ingested parts); once those exist and are passed through `partNumbers`, `indexPart` already routes them into `interchangePartNumbers`. Seller-uploaded parts, whose workbooks carry OEM-reference columns, already populate both sides.

## FEBEST website enrichment (live PDP only)

FEBEST product images and compatibility are resolved **in real time** when a buyer opens a part detail page (`GET /api/search/parts/:id`):

1. Detect FEBEST parts (brand / FEBEST supplier offer + MPN)
2. Live lookup: `https://febest.de/en/catalog?code={MPN}` → details page
3. Return hotlinked `static.febest.de` image URLs + compatibility rows with `source: febest.de`
4. **Nothing is written** to Postgres for this path (`enrichmentLive: true` on the response)

Search result cards do not pre-fetch febest media. The optional offline script `apps/api/scripts/enrich-febest-from-website.mjs` is retained for one-off backfills only and should not be used as the default path.
