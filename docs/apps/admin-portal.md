# admin-portal

**Last reviewed:** 2026-08-26

Internal admin console. Lives at `apps/admin-portal`, Next.js, dev port 3000 (same caveat as [[seller-portal]] re: port conflicts when running multiple apps locally).

## Order fulfillment


## 2026-08-26 blog CMS

/blog is the authenticated Blog CMS. It lists drafts and published posts,
auto-generates a slug from the title until manually edited, supports plain-text
content with simple headings/lists, cover and SEO fields, draft/publish state,
public preview, and delete. The API allows `ADMIN` and the least-privilege `SEO_EDITOR` role on the CMS
CRUD routes; the buyer app exposes published posts only. SEO editors are
accepted by the admin login, routed directly to `/blog/`, and see no other
admin navigation or pages. Provision them with the API image's
`seed:seo-editor` command using explicit `SEO_EDITOR_EMAIL` and
`SEO_EDITOR_PASSWORD` environment variables; the normal marketplace seed does
not create or reset the account unless `SEED_SEO_EDITOR_PASSWORD` is supplied.

The Orders detail page shows each seller shipment independently. Admins and
fulfillment operators can select only the next valid delivery state, update a
tracking number/carrier, and save through the authenticated operations API.
The lifecycle is `PROCESSING` → `SHIPPED` → `DELIVERED`; cancellation is
available before shipment. The API remains authoritative for transition
validation and audit logging, so the UI cannot bypass the workflow.

## Depends on
- [[../packages/ui]]
- [[../packages/catalog-contracts]]
- [[api]] — likely the primary consumer of `operations`, `audit`, and `merchant` modules

## Primary API areas

- `operations` for orders, fulfillment, sellers, support, and operational
  dashboard data.
- `auth` for admin and fulfillment-operator sessions.
- `catalog-import` for catalog governance queues.

## RealTrack bridge

`/realtrack-bridge` lets an admin search and select individual active
PartsBazar seller offers, inspect the formula result and skip reason, then
transfer the selected records into RealTrack. It defaults to transfer-only;
the optional eBay publish checkbox requires RealTrack store IDs and a bridge
write account with eBay publish permission.

The offer list is fully pageable and supports brand, source, seller,
offer-status, keyword, and optional source-currency filters. Source costs are
converted to USD automatically; the target currency is fixed to USD. Each row
reports the original cost, converted USD cost, image count, fitment count, and
any skip reason. “Select all” resolves the complete filtered result on the API,
up to 5,000 offers, rather than selecting only visible rows. The transfer
payload includes the complete image gallery, stored item details, and all
available compatibility/fitment rows. RealTrack persists the gallery and raw
fitment rows on the canonical catalog product during listing creation, and the
optional eBay publish step also sends normalized compatibility. Large transfers
run in the background;
the page polls the job and shows transferred/failed progress while the API
paces and retries rate-limited RealTrack writes. Seller choices come from the
admin seller directory; the API remains authoritative for the default ACTIVE
status and all transfer eligibility checks.
