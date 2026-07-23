# RealTrack API — Requirements for PartsBazar360 Marketplace Populate

**Date:** 2026-07-23  
**Audience:** RealTrack platform / Published Listings Sync owners  
**Consumer:** PartsBazar360 (`api-published-listings@realtrack.local`)  
**Base URL:** `https://mhn.realtrackapp.com/api`  
**Priority stores for marketplace:**

| Seller on PartsBazar | RealTrack storeId | storeSlug (if any) |
|----------------------|-------------------|--------------------|
| Blackline Auto Parts | `d16199c4-55b5-429e-ad27-892bed94e00d` | `blacklineusedautoparts` |
| Salvage Auto Parts | `3b84b063-3811-481f-a61d-f7846a03558f` (US SalvageA) | — |
| (legacy reference) K. Salvage Auto Parts | `eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0` | — |

---

## 1. Diagnosis — why Blackline / Salvage look “empty”

Probed live on **2026-07-22** with the Published Listings Reader account (`published_listings.view` only). Auth and org membership are healthy.

### 1.1 Auth / access — OK

- Login succeeds for `api-published-listings@realtrack.local`
- `GET /auth/me` → role `api_published_listings_reader`, permission `published_listings.view`
- Org: Super Admin `3ed54be6-7138-4264-bd8b-73dfa9336245`
- Account is active; this is **not** a credentials failure

### 1.2 Mirror is not globally dead — but target stores are

Unfiltered `GET /published-listings` returns `total: 0` (see bug below), but **per-store** totals still work:

| Store | Active published total (live) | Contract baseline |
|-------|-------------------------------|-------------------|
| B.JLRWORLD | **37,199** | — |
| K. Euro Japan Auto Parts | **36,360** | — |
| VW & RR | **15,600** | — |
| K. Salvage Dismantlers - DE | **11,431** | — |
| K. Southern Cross Auto Parts - AU | **5,000** | — |
| **BLACKLINEAUTOPARTS** | **0** (all statuses) | connected store in reader doc |
| **K. Salvage Auto Parts** | **0** (all statuses) | **71,512** in reader doc |
| **US SalvageA** (`3b84b063-…`) | **0 active**; **4,267 ended** | not in original 11-store table |
| All About Mercedes / Brit Auto / Primemotive / eBay store | 0 | connected in doc |

**Conclusion for RealTrack ops:**

1. **Blackline** — store is reachable (detail 404s correctly), but `ebay_published_listings` has **no rows** for that `storeId` under any status filter (`active`, `ended`, `INACTIVE`, etc.). Treat as **PublishedListingsSyncService not syncing / eBay account disconnected / listings purged**.
2. **K. Salvage** — previously ~71.5k in the contract; now **0**. Same class of failure as Blackline (sync stopped or data removed).
3. **US SalvageA** — store exists and was synced as recently as `lastSyncedAt ≈ 2026-07-21T16:08:44Z`, but only **ended** rows remain (~4.3k). **No active inventory** is currently mirrored. Either eBay active listings are gone, or active sync is failing while ended retention remains.
4. PartsBazar marketplace seed maps Salvage → **SalvageA**, not legacy K. Salvage. Both need fixing if Salvage inventory is expected.

### 1.3 API bug — global list total

| Query | Observed |
|-------|----------|
| `GET /published-listings?page=1&limit=1` | `total: 0` |
| Sum of the same query with each known `storeId` | **~105,590** |

Unfiltered pagination/total is broken or filtered incorrectly. Consumers must query **by `storeId`**. Please fix so global `total` equals the sum of accessible store inventories.

### 1.4 Payload gaps (even on healthy stores)

Sampled live Euro Japan + SalvageA ended detail payloads. Schema fields exist, but values needed for eBay-parity listings are missing:

| Field | Present on schema? | Observed value | Needed for PartsBazar |
|-------|--------------------|----------------|------------------------|
| `title`, `price`, `currency`, `quantityAvailable`, `listingStatus`, `listingUrl`, `sku`, `ebayItemId` | yes | usually populated | yes |
| `imageUrls` | yes | often 1 thumb (`s-l140`) or GridX-only; full galleries inconsistent | **all** listing images, preferably including `i.ebayimg.com` full-size |
| `description` | yes (key exists) | **empty / null** on samples | HTML or plain text eBay description |
| `compatibility` | yes | **null** on samples | full eBay Motors fitment rows |
| `itemSpecifics` | yes | often `{}` while healthFlags say “missing_item_specifics” | Make/Model/Year/OEM/MPN/Brand/etc. |
| `condition` | yes | sometimes `"Used"` / `"Gebraucht"`, often null | always populated |
| `rawEbayResponse.item` | yes | thin: no picture gallery array beyond 1 URL, no compatibility, no description | richer Trading / Inventory snapshot |

Historical PartsBazar DB residue (legacy K. Salvage import): ~142k parts, median **1** image, **≤1** fitment row/part, **0** descriptions — consistent with thin mirror payloads, not a PartsBazar-only bug.

---

## 2. Immediate ops asks (unblock populate)

Please treat these as P0 before PartsBazar re-seeds:

1. **Restore / re-run `PublishedListingsSyncService` for:**
   - `d16199c4-55b5-429e-ad27-892bed94e00d` (BLACKLINEAUTOPARTS)
   - `3b84b063-3811-481f-a61d-f7846a03558f` (US SalvageA) — active listings
   - Optionally `eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0` (K. Salvage) if still a source of truth
2. Confirm each store’s **eBay account token** is valid and Inventory/Trading sync is succeeding (not only writing `ended` rows).
3. Confirm expected active counts (contract: K. Salvage alone was ~71k; Blackline historically tens of thousands).
4. Fix unfiltered `GET /published-listings` total/pagination (`0` vs ~105k by store).
5. Add reader-visible **sync health** (see §4) so we can detect empty mirrors without SSH probes.

**Acceptance for P0:**

```http
GET /published-listings?storeId=d16199c4-55b5-429e-ad27-892bed94e00d&page=1&limit=1
→ total > 0, listingStatus=active for the majority of inventory

GET /published-listings?storeId=3b84b063-3811-481f-a61d-f7846a03558f&page=1&limit=1
→ total > 0 active (not only status=ended)
```

---

## 3. Product requirements — eBay-parity listing payload

PartsBazar needs each **active** published listing (list + detail) to be complete enough to render like an eBay Motors listing: full gallery (eBay images first), complete fitment table, description, and item specifics.

### 3.1 Endpoints (keep existing; enrich payloads)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/login` | unchanged |
| GET | `/auth/me` | unchanged |
| GET | `/published-listings` | must work with and without `storeId`; fix global total |
| GET | `/stores/{storeId}/listings/published` | keep |
| GET | `/stores/{storeId}/listings/published/{listingId}` | **canonical rich detail** — must include fields below |
| GET | `/stores` **(new for reader)** or dedicated store catalog | see §4 — currently 403 without `stores.view` |

Detail must remain available with only `published_listings.view`.

### 3.2 Required fields on every active listing (list may be slim; detail must be full)

#### Identity & commerce
- `id`, `organizationId`, `storeId`, `storeSlug` (if available)
- `marketplaceId` (e.g. `EBAY_MOTORS_US`)
- `ebayItemId`, `offerId` (nullable for legacy Trading path)
- `sku`, `title`
- `price` (number or decimal string), `currency` (ISO 4217)
- `quantityAvailable`, `listingStatus` (`active` | `ended` | … — document enum)
- `listingUrl`
- `condition` (normalized + original display string)
- `categoryId`, `categoryName`
- `lastSyncedAt`, `ebayStartTime`, `ebayEndTime`

#### Description (P0 for “looks like eBay”)
- `descriptionHtml` — full eBay listing description HTML
- `descriptionText` — stripped plain text fallback  
  Today `description` exists but is empty; populate from eBay Item description / Inventory product description.

#### Images (P0)
- `imageUrls: string[]` — **complete ordered gallery**
  - Include every picture from eBay PictureDetails / Inventory media
  - Prefer absolute `https://i.ebayimg.com/...` URLs at **large** size (`s-l1600` or equivalent), not only `s-l64` / `s-l140`
  - If GridX / CDN mirrors also exist, return **both**, with a stable order:
    1. eBay-hosted URLs first (gallery order)
    2. other CDNs after
  - Optional but preferred: `images: [{ url, source: "ebay"|"gridx"|"other", sortOrder, isPrimary }]`

#### Fitment / compatibility (P0)
Populate `compatibility` on detail for Motors listings. Preferred shape (already partially handled by PartsBazar):

```json
{
  "compatibleProducts": [
    {
      "compatibilityProperties": [
        { "name": "Year", "value": "2018" },
        { "name": "Make", "value": "Toyota" },
        { "name": "Model", "value": "Corolla" },
        { "name": "Trim", "value": "LE" },
        { "name": "Engine", "value": "1.8L" }
      ]
    }
  ]
}
```

Requirements:
- Mirror **all** eBay Motors compatibility rows (not a truncated sample)
- Preserve Year/Make/Model/Trim/Engine/Notes when present
- If eBay has no compat, return `compatibility: null` explicitly and set health flag `missing_compatibility`
- Do **not** rely on title parsing on the consumer side for verified fitment

#### Item specifics / OEM (P0)
- `itemSpecifics`: non-empty map/array of Name→Value(s) from eBay  
  At minimum when available: Brand, Manufacturer Part Number, OE/OEM Number, Type, Placement on Vehicle, Interchange Part Number
- Top-level convenience fields when known: `brand`, `mpn`, `oeNumbers: string[]`

#### Salvage provenance (P1 for Salvage stores)
When available from eBay specifics or RealTrack inventory metadata:
- donor year/make/model/trim
- mileage + unit
- stock / yard / bin
- VIN (masked OK)
- condition grade / tested status  

Expose under e.g. `salvageDetails: { ... }` so PartsBazar can populate `SalvageUnit` / `DonorVehicle`.

#### Raw snapshot (P1)
- `rawEbayResponse` should retain enough to rebuild gallery + compat + description if normalized fields lag  
  Include picture URL arrays, ItemSpecifics, ItemCompatibilityList / product compatibility, Description.

### 3.3 Sync completeness SLOs

| Metric | Target |
|--------|--------|
| Active Blackline + SalvageA mirrored within | ≤ 15 minutes of eBay publish/revise |
| Detail `imageUrls.length` vs eBay gallery | ≥ 95% of listings match count |
| Detail with non-null `compatibility` when eBay has Motors fitment | ≥ 98% |
| Detail with non-empty description | ≥ 98% of listings that have description on eBay |
| Ended retention | keep ended ≥ 30 days for reconciliation; active query must not require ended-only data |

### 3.4 Health flags (extend existing)

Keep current flags; add/ensure:
- `missing_compatibility`
- `missing_description`
- `weak_images` (already exists)
- `missing_item_specifics` (already exists — ensure it matches empty `{}`)
- `sync_stale` when `lastSyncedAt` older than threshold
- `store_sync_failed` at store-level health endpoint

---

## 4. Reader account / discovery requirements

Today the reader cannot call `GET /stores` (403 Insufficient permissions). Please either:

**Option A (preferred):** grant `stores.view` (read-only) to `api_published_listings_reader`, **or**

**Option B:** add:

```http
GET /published-listings/stores
→ [{ storeId, storeSlug, name, activeListingCount, endedListingCount, lastSyncedAt, syncStatus }]
```

Also add:

```http
GET /published-listings/sync-status
→ {
  organizationId,
  globalActiveCount,
  stores: [{ storeId, activeCount, endedCount, lastSuccessAt, lastErrorAt, lastError }],
  generatedAt
}
```

This would have immediately shown Blackline/SalvageA as empty vs other live stores.

Document `storeAccessAll` and keep SalvageA (`3b84b063-…`) in the connected-store set if it is a first-class marketplace source (it is missing from the original 11-store reader table).

---

## 5. Filter / contract clarifications

1. Document exact `status` enum and case rules (`active` vs `ACTIVE` vs `ended`).
2. Default list filter should return **active** inventory; support explicit `status=ended` for reconciliation (already works for SalvageA).
3. Fix global list without `storeId` (total currently 0).
4. Pagination: stable ordering (e.g. `id` or `lastSyncedAt,id`); document max `limit` (200).
5. Rate limits: document 429 behavior; allow sustained detail fetch (~1 detail/listing) for full catalog seed (Blackline + Salvage historically ~25k–70k+ each).

---

## 6. Acceptance tests PartsBazar will run after RealTrack update

```bash
# 1) Blackline active inventory restored
GET /published-listings?storeId=d16199c4-55b5-429e-ad27-892bed94e00d&limit=1
expect: total > 0

# 2) SalvageA active inventory restored
GET /published-listings?storeId=3b84b063-3811-481f-a61d-f7846a03558f&limit=1
expect: total > 0  (status default/active)

# 3) Global total sane
GET /published-listings?limit=1
expect: total ≈ sum of per-store active totals

# 4) Detail richness (sample N=20 active from each target store)
GET /stores/{storeId}/listings/published/{id}
expect for ≥95%:
  - imageUrls.length >= eBay gallery count (or ≥3 when listing has ≥3 on eBay)
  - at least one i.ebayimg.com URL when eBay hosts images
  - descriptionHtml or description non-empty when eBay has description
  - compatibility.compatibleProducts length matches eBay Motors fitment when present
  - itemSpecifics non-empty when eBay has specifics
```

After P0+P1 land, PartsBazar will re-run `seed:realtrack-dynatrade` / `syncStoreComplete` (detail-fetch path) for Blackline + Salvage only.

---

## 7. Out of scope for RealTrack (PartsBazar-owned)

- Sorting eBay-hosted URLs first in our catalog (already implemented once URLs are present)
- Buyer PDP layout / OpenSearch indexing
- Spreadsheet sellers (Superior / FEBEST / DXB)
- Downloading image binaries (we store remote URLs only)

---

## 8. Contact artifacts from this investigation

Live probe timestamps: **2026-07-22 ~21:30–21:40 UTC**.  
Reader user id: `2697aa94-2061-4cbd-a414-6b2bd4d63e6e`.  
Baseline contract: `Published Listings Reader.docx` (verified ~314,076 global / ~71,512 K. Salvage at doc time — no longer true for Blackline/K. Salvage/SalvageA active).
