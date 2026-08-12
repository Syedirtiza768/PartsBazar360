# PartsBazar360 — Map of Content

**Last reviewed:** 2026-08-12

Entry point for the vault. This is a monorepo (Turborepo + npm workspaces) for an auto-parts marketplace: buyers, sellers, workshops, and an admin console sit on top of one shared catalog and API.

Open this vault in Obsidian at the repo root (`F:\apps\PartsBazar360`) — the graph view gives you a live picture of how apps, packages, and docs connect. Claude Code also reads these files directly as plain markdown; see [[../CLAUDE.md|CLAUDE.md]] for how it uses them.

## Apps
- [[apps/api]] — NestJS backend: catalog, orders, checkout, search, ingestion
- [[apps/buyer-marketplace]] — public storefront (Next.js)
- [[apps/seller-portal]] — seller-facing listing/inventory management (Next.js)
- [[apps/admin-portal]] — internal admin console (Next.js)
- [[apps/workshop-portal]] — workshop/garage-facing app (Next.js)

## Shared packages
- [[packages/catalog-contracts]] — shared types/schemas between api and frontends
- [[packages/ui]] — shared React component library
- [[packages/scraper-engine]] — eBay/supplier scraping and enrichment engine

## Cross-cutting references
- [[decisions]] — running log of non-obvious decisions and why they were made
- [[MOTOR_PARTS_CATALOG_ARCHITECTURE]] — catalog data model and buyer experience
- [[IMPLEMENTATION_PLAN]] — living plan tying catalog/import/seed/buyer/seller/admin together
- [[SEEDING_AND_IMPORTS]] — how marketplace data gets seeded and imported
- [[SEO_ARCHITECTURE]] — the programmatic SEO engine: slugs, URLs, metadata, schema, taxonomy pages, indexability, sitemaps
- [[DESIGN_SYSTEM]] — visual/UX system ("Workshop Ledger" direction)
- [[RESPONSIVE_SYSTEM]] — cross-device responsive handling
- [[CHECKOUT_GUEST_FIRST]] — guest-first SMS verification, customer identity, payment retry, and optional accounts
- [[SEARCH_OVERHAUL_AUDIT_AND_PLAN]], [[SEARCH_PHASE1_AUDIT]], [[SEARCH_PHASE2_RESULTS]] — search/filtering/pagination work
- [[FILTERS_UX_AUDIT]], [[UX_AUDIT]] — UX audits
- [[MARKETPLACE_TRANSFORMATION]] — eBay-Motors-style transformation history
- [[REALTRACK_API_REQUIREMENTS]] — external data source requirements

## Operational context
- Local dev, deploy, and infra gotchas: see `memory/dev-workflow-no-docker.md`, `memory/deploy-must-use-update-sh.md`, and `memory/long-jobs-need-standalone-container.md` in Claude's memory store (not part of this vault, but load-bearing — ask Claude to check them).
- Deploys go through `update.sh`, not a bare `docker compose up --build` (that skips the nginx reload).

## Keeping this vault alive
This map is only useful if it's updated alongside the code. When you (or an AI session) make an architecturally significant change — new module, new data flow, a non-obvious workaround — update the relevant note and add an entry to [[decisions]] rather than letting it live only in a commit message or your head.
