# Marketplace Complete Implementation Plan

Living plan for closing catalog architecture, import, seed, buyer, seller, and admin into one linked system. Phases align with `docs/MOTOR_PARTS_CATALOG_ARCHITECTURE.md`.

## System map

```text
Sources → Import (detect → map → stage → classify → match → preview → commit)
       → Catalog + Offers + Inventory + Salvage + FitmentEvidence
       → SearchOutbox → OpenSearch
       → Buyer / Seller / Admin (shared @repo/catalog-contracts)
       → ReviewTask + AuditEvent
```

## Invariants

1. Brand ≠ vehicle make ≠ seller  
2. Catalog product ≠ seller offer ≠ warehouse inventory ≠ salvage unit  
3. OEM cross-reference ≠ verified fitment  
4. Zero stock stays zero; no silent currency/unit inference  
5. Original source values are never destroyed  
6. Idempotent upserts by stable external keys  

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 Contracts | Done | `@repo/catalog-contracts` shared enums/labels |
| 1 Data spine | Done | FitmentEvidence, ReviewTask, AuditEvent, CanonicalPartRedirect, SearchOutbox, staging fields |
| 2 Staging import | In progress | STAGED/IMMEDIATE modes, preview + commit APIs, seller wizard foundation |
| 3 Admin governance | In progress | `/admin/catalog` queues API + admin UI; merge UI still pending |
| 4 Fitment + search v2 | Partial | `POST/GET /fitment/check`; FitmentEvidence writes; full reindex worker pending |
| 5 Buyer coherence | Partial | Warehouse stock on offers, part-type badges, salvage panel; compare page pending |
| 6 Seed/RealTrack scale | Partial | Seed still uses IMMEDIATE commit through production upload path |

## Critical path remaining

1. Interactive column-mapping UI (drag/drop + saved templates)  
2. Admin product merge + redirects UI  
3. Search outbox consumer (decouple sync `indexPart`)  
4. Buyer compare page + salvage import template  
5. Standalone reindex script for interchange fields  
6. VIN decode partner (Phase 6)

## API contracts added

- `PUT /merchant/uploads/:jobId/mapping`
- `GET /merchant/uploads/:jobId/preview`
- `POST /merchant/uploads/:jobId/commit`
- `GET|POST /fitment/check`
- `GET /admin/catalog/queues`
- `GET /admin/catalog/reviews`
- `PATCH /admin/catalog/reviews/:id`
- `GET /admin/catalog/audit|brands|makes`

## Seed note

`npm run seed:marketplace --workspace api` continues to use `commitMode=IMMEDIATE` by default so existing automation stays green. Seller portal defaults to `STAGED` so humans preview before live writes.
