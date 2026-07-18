# Marketplace seeding and seller imports

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
