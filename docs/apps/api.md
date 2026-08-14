# api

**Last reviewed:** 2026-08-14

NestJS backend for the whole marketplace. Lives at `apps/api`.

## Stack

- NestJS (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`)
- Prisma 7 + Postgres (`@prisma/client`, `@prisma/adapter-pg`)
- OpenSearch (`@opensearch-project/opensearch`) for search
- Redis + BullMQ for background jobs (`@nestjs/bullmq`, `bullmq`, `ioredis`)
- Shared types from [[../packages/catalog-contracts]]

The Compose Postgres service is given a 1 GiB `/dev/shm` allocation. The
default 64 MiB Docker mount is insufficient for concurrent Prisma/Postgres
queries and reports as `No space left on device` even when the host disk has
free capacity.

Run modes: `start:dev` (web process, watch), `start:worker` (background job worker — separate process, see `src/worker.js`).

## Modules (`src/modules/*`)

- `auth` — authentication (see [[../decisions]] re: email vs SMS OTP)
- `cart`
- `catalog-import` — bulk catalog import pipeline
- `checkout`
- `email`
- `enrichment` — data enrichment (brand mapping, item specifics, etc. — ties into [[../packages/scraper-engine]] and root-level enrich/import scripts)
- `garage` — buyer's saved vehicles ("garage")
- `ingestion`
- `integration`
- `inventory`
- `listing-pipeline`
- `merchant`
- `operations`
- `order`
- `pricing`
- `search` — see [[../SEARCH_OVERHAUL_AUDIT_AND_PLAN]], [[../SEARCH_PHASE1_AUDIT]], [[../SEARCH_PHASE2_RESULTS]]
- `seed` — marketplace seeding, see [[../SEEDING_AND_IMPORTS]]
- `sms` — SMSGlobal REST API (see [[../decisions]])
- `vehicle`

The `sms` module records bounded, redacted provider diagnostics when an
SMSGlobal send fails, including the HTTP status and safe response details.

## Orders, fulfillment, and confirmations

The parent `Order.status` is the payment lifecycle (`PENDING_PAYMENT`,
`PAID`, `PAYMENT_FAILED`, `CANCELLED`, `REFUNDED`). Delivery is tracked
independently on each `SellerOrder`, because one checkout may contain
shipments from several sellers. Admin/fulfillment staff update a seller
shipment through `PATCH /operations/seller-orders/:sellerOrderId/fulfillment`;
the API validates the next allowed transition, writes an audit event for
status changes, and uses a compare-and-update guard so stale admin screens
cannot overwrite a newer status.

After the payment provider confirms success, checkout sends the order
confirmation to both the verified customer email (SendGrid) and phone
(SMSGlobal) when those channels are available. It resolves contacts from the
guest-first `Customer` identity as well as the legacy linked `User`, so a
guest checkout is not skipped. Notification delivery is best-effort and does
not roll back a paid order; payment-claim idempotency prevents webhook races
from sending duplicate confirmations.

## Guest-first checkout

Checkout identity is separate from account authentication. `Customer` owns the
verified E.164 phone and order history; a `User` password account is optional.
Short-lived `CheckoutSession` tokens authorize one transaction without exposing
account data. OTP challenges are hashed, rate limited, attempt limited, and
consumed once. Order creation is idempotent and payment retries create
`PaymentAttempt` audit rows on the same order. See [[../CHECKOUT_GUEST_FIRST]].

The hidden payment-verification part is a deliberate checkout-only exception:
`PAYMENT_TEST_PART_ID` contributes zero chargeable shipping weight, so its
shipping quote is free. If it is combined with normal items from the same
seller, only those normal items contribute to the seller shipment quote.

_(This list is mechanically generated from the folder structure — module responsibilities beyond the name are TODO. Fill in as you touch each one.)_

## Seed / import / enrichment CLIs

A large surface of one-off `npm run` scripts lives here for populating data from external sources: `seed:realtrack-dynatrade`, `seed:salvagea`, `seed:blackline`, `enrich:febest`, `enrich:dxb`, `import:mvl`, `backfill:compat-mvl`, `enrich:itemspecifics`, `cleanup:ebay-feed`, `export:salvage`. See `apps/api/package.json` for the full, current list — supplier integrations churn, so treat that file as the source of truth over this note.

`scripts/tavily-image-superior-listings.mjs` is a conservative production utility
for active `Superior Auto Parts` offers whose canonical part has no image. It
uses Tavily image-enabled search, requires exact brand + MPN evidence in both
the image metadata and a source result, rejects known placeholders and vehicle
photos, validates the image URL, then writes `CanonicalPart.imageUrls` and
`ProductMedia` without replacing an existing image. Use `--limit` for a pilot
and `--after` as a UUID cursor for resumable batches; pass the API key only as
the runtime `TAVILY_API_KEY` environment variable.

`scripts/enhance-superior-imaged-luna.mjs` is the GPT-5.6 Luna quality pass for
all active Superior products. It validates the current primary image when one
exists, sends the image plus catalog evidence to OpenRouter, and publishes only
high-confidence identity matches with no contradictions. Existing image URLs are
never replaced; no-image rows can receive factual SEO content but remain noindex
until the image gate passes. The worker persists an `_seo` evidence block inside
`itemSpecifics`, strips an MPN duplicated in the OE array, and writes sectioned
SKU-specific descriptions only from supplied evidence; it does not invent fitment,
OE references, dimensions, or axle/set language. Review rows are reported without
catalog writes. Run bounded windows and preserve the backup/report paths.

`scripts/rectify-febi-images-luna.mjs` is the evidence-first repair worker for
active listing images. It can target a brand or a deduplicated `IDS_PATH` of
candidate parts (used for Superior proposals that were not fully approved),
reviews every distinct URL from both `imageUrls` and `ProductMedia` in parallel,
and sends current catalog metadata, offer metadata, and compatibility evidence
with each image. It removes only a high-confidence Luna mismatch or unusable
image, leaves REVIEW results untouched, writes a JSONL backup/report, and
enqueues changed parts through `SearchOutbox` so buyer search is refreshed.
Run a small `DRY_RUN=1` pilot before the live pass; use bounded `WORKERS` and
keep the backup/report files with the operational record.

`scripts/apply-superior-official-recovery.mjs` is the write-side of the
no-image official-brand recovery pass. The connected You.com lookup layer must
first return an official manufacturer page, an exact brand + manufacturer-part-
number match in that page, and an image URL extracted from that same page. The
script rechecks the official hostname, exact part number, image-page linkage, and
direct image content type before asking Luna to create the PDP update. It writes
only an approved exact match, stores the source and match evidence in
`itemSpecifics._official`, updates `_seo` to the official recovery source, and
adds the validated image to `ProductMedia`; unmatched, ambiguous, missing-image,
or unsupported-brand rows are skipped and reported. For no-image rows, an exact
official image is accepted as the image match when the URL is valid and tied to
the exact official page; stale catalog claims are corrected when the official
evidence resolves them, while unresolved contradictions still route to review.
Set `OFFICIAL_WORKERS` to a bounded value for concurrent Luna/database workers;
each worker uses its own database client and the row-level image/identity gates
remain unchanged. The feed remains deliberately separate from the API
container so lookup evidence can be reviewed and replayed without exposing
provider credentials to application code.

`scripts/mvl-oe-recovery-job.mjs` is the resumable server-side worker for
vehicle compatibility recovery. `--init` creates a durable Postgres job and
queues active Superior Auto Parts canonical parts that still have OE/MPN input;
`--status JOB_ID` reports processed counts, attached MVL rows, heartbeat, rate,
and ETA; `--export` and `--ingest` provide a feed boundary for the connected
You.com lookup layer; and `--run --no-research` validates ingested applications
against exact `MvlVehicle` make/model/year rows before writing fitments and
evidence transactionally. When `YDC_API_KEY` is configured in the production
worker, as it is for the current production job, `--run` performs the Research
API calls directly. If the key is unavailable, the server job remains queued
while task-side You.com results are ingested. Claims
use `FOR UPDATE SKIP LOCKED`, so bounded parallel workers can process the same
job safely and retries survive container replacement.

`scripts/run-superior-official-recovery-job.mjs` is the resumable server-side
coordinator for this pass. It selects the next active no-image rows by UUID
cursor, sends one batched discovery query to You.com's MCP `you-search` with
livecrawl enabled, validates exact first-party pages and MPN-tied images, then
hands only the accepted evidence to the write-side Luna script. It stores
`status.json`, `events.ndjson`, and the current feed under
`OFFICIAL_JOB_STATE_DIR` (the production worker's persistent enrichment volume),
uses a lock to prevent duplicate runs, and resumes safely after interruption.
Run it in the worker container with `OFFICIAL_JOB_WORKERS=4` and
`OFFICIAL_YOU_WORKERS=4`; set `YDC_API_KEY` in the server `.env` for paid MCP
limits, otherwise it uses You.com's keyless free MCP profile and records that
mode in the status file. No reseller page or image is accepted as a substitute.

## Consumers

`scripts/repair-mpn-dedup-merges.mjs` repairs the historical brand-blind MPN
merge batch. It is dry-run by default; `APPLY=1` applies only redirects with a
structured identity blocker and no ambiguous offer mapping. It restores offers
using upload candidate IDs or unique seller-title evidence, moves brand-scoped
part numbers where evidence exists, writes `REPAIR_MPN_DEDUP` audit events, and
queues source and target parts for search indexing. Review the generated report
before applying it in production.
All four frontend apps ([[buyer-marketplace]], [[seller-portal]], [[admin-portal]], [[workshop-portal]]) call this API.

## Open questions / TODO

- Document the auth flow end to end (session model, roles per portal).
- Document how `listing-pipeline` and `ingestion` relate (pipeline stages?).

## SEO module (`src/modules/seo/`)

Owns the SEO _lifecycle_ — the [[../SEO_ARCHITECTURE|engine]] itself lives in
[[../packages/catalog-contracts]].

- `SeoSlugService` — assigns a canonical slug once per part and then freezes it;
  `regenerateSlug` retires the old slug to `CanonicalPartSlug` so an old URL
  301s in one hop; `resolve()` maps a current slug, a retired slug, or a legacy
  UUID to a part plus a redirect instruction.
- `SeoCatalogService` — sitemap chunks (cached windowed chunk boundaries, so
  chunk N is one bounded keyset read rather than N queries) and taxonomy
  aggregation with index-eligibility. Cold-cache callers share one in-flight
  aggregate, and expired entries use stale-while-revalidate; this prevents a
  crawler burst from running duplicate full-catalog scans and starving the
  vehicle picker of database connections.
- The API worker and standalone `seo-backfill` CLI set `SEO_CACHE_PRIME=0`.
  Only the request-serving API primes the SEO cache; otherwise each process
  would independently scan the fitment graph at startup.
- `SeoHealthService` — per-listing validation, counters, duplicate detection.
- `SeoController` — `/seo/*` (resolve, sitemap feeds, taxonomy, health,
  overrides, regenerate-slug, cache invalidate, config).

**The load-bearing wiring:** `SearchIndexerService.indexPart` calls
`ensureSlug()` before indexing. Every write path already reaches the indexer via
`SearchOutbox`, so a part cannot become buyer-visible without a canonical URL —
and a _future_ import path inherits that without knowing SEO exists. This is why
`SearchModule` imports `SeoModule`.

Backfill for the existing catalog: `npm run seo:backfill` (run as a standalone
container, not `docker exec`).

### Operational CLIs

| Script                 | Purpose                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `seo:backfill`         | Assign canonical slugs to parts that lack one; prints an SEO health report.                 |
| `backfill:has-image`   | Populate the indexed `hasImage` projection so browse can float imaged listings first.       |
| `payment:test-product` | Create/refresh the hidden 1 AED payment-verification item (`--deactivate` to take it down). |

Two lessons these cost, both worth remembering for any future job of this shape:

- **Bulk OpenSearch writes must be async tasks.** The client's default request
  timeout is 30s. A synchronous `_update_by_query` over ~100k documents closes
  the socket mid-run and reports _no error_ — the first run left 6,037 of
  107,543 documents populated and looked like it had succeeded. Submit with
  `wait_for_completion: false` and poll the task.
- **Nest CLIs must exit explicitly.** `app.close()` does not tear down the
  BullMQ/Redis connections an application context opens, so the process hangs
  after its work is done and a job container never exits.

And, as elsewhere: run long jobs as a standalone `docker run` container, not
`docker compose exec` — an exec session dies when the container is recreated.
