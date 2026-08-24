# enrichment-workbench

**Last reviewed:** 2026-08-15

Local-only review application for enriching every active Superior Auto Parts
listing before approved changes are taken back to the main marketplace. It
lives at `apps/enrichment-workbench` and runs on port 3004.

## Workflow

1. `npm run sync-live-production --workspace enrichment-workbench` performs a
   read-only, paginated export from the live PartsBazar buyer API for every
   Superior source tag (`AAP`, `BST`, `YNTD`, `TNRU`, `PSRC`, `GEN`). It writes
   `tmp/superior-enrichment-workbench/live-production-listings.csv` plus an
   audit JSON containing the source totals and exact listing-ID reconciliation.
   `npm run prepare-data --workspace enrichment-workbench` then prefers that
   live snapshot and merges the checked-in enrichment evidence by listing and
   canonical-part ID. High-confidence validated image matches (0.85+) are
   promoted to primary, with the live production URL retained as fallback. If
   the live snapshot is absent, it falls back to the repository export for offline review.
2. The catalogue view exposes all Superior listings with text search, queue views,
   and combinable filters for status, title, image, compatibility, OE availability,
   brand, category, product type, system, part type, condition, source, and currency.
   Every queue and facet option is ordered by descending listing quantity and shows
   its count. Complete SEO titles
   use `Brand | Short description + MPN | OE number | Fits Make Model`.
3. Compatibility lookup follows a strict evidence hierarchy: genuine OE first,
   then exact normalized Brand + MPN when OE is unavailable. A Brand + MPN match
   is accepted only when the catalogue record has `CONFIRMED` fitment with
   confidence of at least 0.85. A successful lookup fills the reviewed fitment
   rows and builds a concise title from the part brand, description/MPN, OE when
   available, and up to three verified make/model pairs.
4. For unresolved no-OE pairs, `scripts/enrich-mpn-with-luna.mjs` researches the
   exact Brand + MPN through OpenRouter's `openai/gpt-5.6-luna` model with web
   search enabled. It writes resumable JSONL evidence, applies only identity and
   fitment results at confidence 0.85 or higher, and respects the configured
`ENRICHMENT_DAILY_BUDGET_USD` (override with `LUNA_MPN_BUDGET_USD`).
   `scripts/enrich-febi-url-luna-runner.mjs` handles the official FEBI URL-only
   path. It ranks the live catalog by price, deduplicates MPNs, uses only
   `openai/gpt-5.6-luna` with the exact bilstein-group partsfinder URL, and
   records resumable JSONL evidence plus exact usage cost under `tmp/`.
   `prepare-data.mjs` promotes the official `pf-article-zoomed` image as the
   listing primary image, applies page OE references, and uses the verified OE
   index to add make/model fitment to titles when available. If the URL fetch
   exposes only the client-rendered `PRODUCT_APPLICATIONS` placeholder, vehicle
   rows are not invented; a source-supported make-only `Fits Make` title is used
   where the OE table provides a make.
   `scripts/enrich-lemforder-fcpeuro-luna-runner.mjs` handles Lemforder through
   the exact FCPEuro search URL `LEM-<MPN>`. It selects the first visible result
   unless the application short description contains the standalone word `kit`,
   in which case it selects the second result, then fetches that FCPEuro product
   page with the pinned `openai/gpt-5.6-luna` model. Resumable evidence keeps
   exact image URLs, Item Specifics, fitment rows, selection URLs, and usage cost;
   `prepare-data.mjs` surfaces those fields in the local review drawer and export. The runner groups the complete Lemforder catalogue by normalized MPN before applying limits, reuses non-error evidence from prior batch JSONL files, and extracts FCPEuro's visible vehicle/application title line as a title fallback without inventing compatibility rows.
   The completed 2026-08-15 run covered 1,477 listings and 1,430 unique MPNs: 1,425 new Luna requests plus five reused pilot records, with 0 failures, 800 accepted evidence records, 790 image-bearing records, 799 vehicle-title records, 3 Item Specifics records, and 0 rendered fitment rows. Exact combined model usage cost was $4.90480061; vehicle-title fallbacks do not make compatibility approval-ready.
5. The High-confidence fitment tab reads the accepted Luna JSONL evidence as a
   read-only, searchable, paginated queue. Each row shows identity and fitment
   confidence, exact vehicle applications, OE references, and available sources.
6. Operators edit one listing at a time. Drafts and approvals are persisted in
   a separate local edits file; source CSVs and the production application are
   never mutated.
7. Approval is rejected unless all title components pass, the title is at most
   160 characters, an HTTP(S) image exists, and either a valid make/model/year
   compatibility row or an explicit universal-fit declaration exists. The OE
   and make/model named in the title must match the separately stored values.
8. The export endpoint emits only approved rows, including the reviewed OE
   number, and includes the source update timestamp so a future production
   importer can detect stale writes.

## Data shape and scaling

The generated catalogue index keeps listing summaries, title suggestions,
current images, and image candidates in memory for fast filtering across the
full catalogue. Existing compatibility is held in a byte-offset side index and
loaded only when a listing is opened. Separate normalized OE and exact Brand +
MPN indexes point to those same offsets. Both include only enrichment records
with `CONFIRMED` fitment and confidence of at least 0.85; an aftermarket MPN is
excluded from OE lookup unless the source identifies the part as OEM. OE and
MPN values are therefore lookup keys into existing fitment evidence, not proof
by themselves. This avoids loading the roughly 1 GB normalized compatibility
archive into memory while preserving its complete row sets.

The bulk builder writes a four-section suggestion for every listing. Missing
evidence is stated explicitly as `OE not available` or `Fitment not confirmed`;
vehicle applications are never inferred from an unverified number. Source
labels such as `OE`, `OEM`, `Unknown`, and `Genuine OEM` are not treated as
brands. A known catalogue brand is recovered from the source title only when it
matches a known brand exactly at the start; otherwise the title says
`Unbranded`.

The 2026-08-14 live snapshot contains 60,887 active Superior listings. It
removed 36 listing IDs from the 60,923-row repository export (all 36 were PSRC)
and added none. At the final index build, all 60,887 had complete title
suggestions, 38,686 had current images (5,514 promoted from validated image matches), 23,569 had compatibility rows, 12,405
had confirmed fitment suitable for titles, and 18,538 had an OE number after
live-field reconciliation. Luna evidence contributed 1,123
titles with verified fitment, 1,794 with verified part descriptions, and 772
recovered OE references across 2,348 accepted evidence records. The evidence
indexes contain 9,300 normalized OE keys and 11,101 exact Brand + MPN keys. The
remaining 51,406 titles say `OE not available`, and 48,515 say `Fitment not
confirmed`. These counts are operational observations, not hard-coded assumptions;
rebuilding the index recalculates them.

## Safety boundary

The local review app is intentionally not connected to production write APIs. The approved CSV
is a handoff artifact, not an automatic deployment mechanism. A separate,
explicit importer should validate listing identity and `source_updated_at`
before applying any approved change to the main database.

## Depends on

- The live production snapshot generated by `sync-live-production.mjs` (or the repository export when offline).
- Existing Superior title, image, and compatibility enrichment outputs.
- [[api]] for the eventual controlled production import contract.


## FEBI production replacement and MVL backfill

The controlled FEBI production replacement uses the URL-enriched catalog as the
source of truth. It updates the 2,139 matched canonical parts, active Superior
offers, official zoomed images, OE references, and search outbox, while marking
198 obsolete active FEBI offers inactive rather than deleting them. A JSON backup
is written before the replacement.

Compatibility backfill is DB-only. The scoped helper considers active FEBI
Superior parts without `MVL_VERIFIED`, matches normalized MPN or OE to an
existing MVL-verified donor, validates each donor application against
`MvlVehicle`, copies the validated vehicle configurations into `Fitment`,
updates compatibility and fitment flags, and refreshes OpenSearch. It never
fabricates a vehicle row. In the production run, 319 exact candidates produced
256 verified updates and 63 skips with zero failures; the 63 skips remain pending
for a future source-backed review.

The optional external research worker is not part of this path. Its prepaid
research fallback was paused after a payment-required response; no credit is
needed when the MVL database contains the required vehicle data.

## Official FEBI dynamic Used In Vehicles capture

The static PartsFinder article HTML contains only the PRODUCT_APPLICATIONS
placeholder. scripts/retrieve-febi-partsfinder-applications.mjs reproduces
the official page's client-side JSON:API calls: it loads /api/makes for each
saved FEBI article URL, then loads /api/applications for every returned make
with include=limitations. It uses the saved anonymous PartsFinder session,
does not call an LLM, and writes resumable JSONL records containing the exact
request URLs, makes response, application rows, and included limitation
resources. The completed capture is at
tmp/superior-enrichment-workbench/febi-partsfinder-applications.jsonl.

The 2026-08-15 capture contains 2,333 unique article keys: 2,144 with official
application rows, 189 URLs previously confirmed not found, 368,522 full
vehicle/application rows, and 272,561 included limitation resources. For
example, FEBI 08669 has 64 Mercedes-Benz rows and an official M104992 engine
limitation; FEBI 100169 has 120 BMW/MINI rows and VIN limitation resources.
The raw capture is a source artifact only; it is not applied to production
fitment until rows are normalized and validated against the MVL vehicle table.
## Official FEBI rows deployed to production

On 2026-08-15 the validated dynamic capture was applied transactionally to
2,144 existing FEBI canonical parts (2,139 currently active Superior offers).
The database stores 368,522 normalized `PARTSFINDER_USED_IN_VEHICLES` rows,
including year spans, make/model, variant, engine, capacity, fuel, body,
model-code, application ID, and official limitation notes. Five captured parts
were inactive in production and were updated for data consistency but remain
excluded from the active buyer catalogue. The 47 no-result listings are not
recreated: input records without an official result are skipped, and the
active-offer rule keeps deleted/inactive offers out of search.

The production loader is `/app/scripts/apply-febi-partsfinder-production.mjs`
inside the API container. It creates a rollback JSONL backup before a write and
uses a transaction plus `SearchOutbox` upserts. The full supported
`reindex-active-from-db.mjs` rebuild completed with 108,426 successful
documents and zero failures; its final OpenSearch count was 108,426. The raw
capture remains at
`tmp/superior-enrichment-workbench/febi-partsfinder-applications.jsonl` and
the production rollback backup is retained under `/tmp` on the production
host.
## Lemforder production replacement and MVL compatibility

On 2026-08-15 the FCPEuro Luna evidence was applied to the exact active
Superior scope: 1,430 Lemforder canonical parts and 1,431 active offers. The
payload replaced titles, accepted FCPEuro descriptions, OE numbers, images,
Item Specifics, product media, and active-offer titles/SKUs, then queued the
parts through `SearchOutbox`. A production JSON backup is retained locally at
`tmp/superior-enrichment-workbench/lemforder-replacement-backup-2026-08-15.json`.

The Lemforder MVL helper matched application compatibility and FCPEuro vehicle title data to
`MvlVehicle`, using one row per market/year/make/model and a transactional set-based
hierarchy/fitment upsert. It produced 95,799 MVL-backed `Fitment` rows across 910 parts and
writes `MVL_VERIFIED` plus `LEMFORDER_FCPEURO` flags. Trusted FCPEuro product-title/application
fallbacks now cover four parts with 15 confirmed compatibility rows; these rows preserve the
source URL and leave year/configuration fields blank when the FCPEuro title does not provide
them. The targeted gap refresh also updated 499 gap titles, and a global cleanup removed the
prohibited fitment-warning suffix from 16 older Lemforder titles.

Final production verification is 1,430 active parts: 938 `CONFIRMED`, 492 with source enrichment still pending,
495 with empty compatibility arrays, zero prohibited fitment-warning titles, and 934 parts
with relational `Fitment` rows. The gap refresh cost $0.15614822 for 499 Luna requests; four
product URLs were verified, while the remaining FCPEuro lookups were blocked or returned
404/429 responses. No compatibility rows were invented from an MPN alone. The trusted source
examples include 4235701 (BMW Cooper Countryman/Clubman), 2718401 (Volkswagen A3, Beetle,
CC, Eos, Golf, and GTI), 3755701 (Porsche Panamera), and 4282701 (Mercedes-Benz GLE/GLS).
Rollback snapshots are `lemforder-mvl-backup-setbased-2026-08-15.json`,
`lemforder-url-compat-backup-2026-08-15.json`, `lemforder-url-candidate-backup-2026-08-15.json`,
and the gap-refresh backups in the same temporary work area.

The reusable production-side helpers are `scripts/apply-lemforder-production-replacement.mjs`,
`scripts/backfill-lemforder-compat-from-mvl.mjs`, and
`scripts/backfill-lemforder-url-compatibility.mjs`; they are copied into the
API container only for an explicitly approved run. Buyer search uses the
`parts_search` alias (`canonical_parts_v3`), and all Lemforder outbox rows were
observed as `DONE` after the run.