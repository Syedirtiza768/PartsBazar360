# api

**Last reviewed:** 2026-08-12

NestJS backend for the whole marketplace. Lives at `apps/api`.

## Stack
- NestJS (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`)
- Prisma 7 + Postgres (`@prisma/client`, `@prisma/adapter-pg`)
- OpenSearch (`@opensearch-project/opensearch`) for search
- Redis + BullMQ for background jobs (`@nestjs/bullmq`, `bullmq`, `ioredis`)
- Shared types from [[../packages/catalog-contracts]]

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

*(This list is mechanically generated from the folder structure — module responsibilities beyond the name are TODO. Fill in as you touch each one.)*

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
remain unchanged. The feed is deliberately
separate from the API container because the connected You.com credential is
available to the task lookup layer, not currently configured in the production
container.

## Consumers
All four frontend apps ([[buyer-marketplace]], [[seller-portal]], [[admin-portal]], [[workshop-portal]]) call this API.

## Open questions / TODO
- Document the auth flow end to end (session model, roles per portal).
- Document how `listing-pipeline` and `ingestion` relate (pipeline stages?).
