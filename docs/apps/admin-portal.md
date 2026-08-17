# admin-portal

**Last reviewed:** 2026-08-17

Internal admin console. Lives at `apps/admin-portal`, Next.js, dev port 3000 (same caveat as [[seller-portal]] re: port conflicts when running multiple apps locally).

## Order fulfillment

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
