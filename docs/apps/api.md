# api

**Last reviewed:** 2026-08-07

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

## Consumers
All four frontend apps ([[buyer-marketplace]], [[seller-portal]], [[admin-portal]], [[workshop-portal]]) call this API.

## Open questions / TODO
- Document the auth flow end to end (session model, roles per portal).
- Document how `listing-pipeline` and `ingestion` relate (pipeline stages?).
