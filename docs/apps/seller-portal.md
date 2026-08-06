# seller-portal

**Last reviewed:** 2026-08-06

Seller-facing app for managing listings, inventory, and orders. Lives at `apps/seller-portal`, Next.js, dev port 3000 (runs on a different port than `buyer-marketplace` when both are up locally — check `.claude/launch.json` / actual dev process for the assigned port).

## Depends on
- [[../packages/ui]]
- [[../packages/catalog-contracts]]
- [[api]] — inventory, pricing, order, merchant modules

## Known feature areas
- Listing management, tied to `api`'s `listing-pipeline` and `catalog-import` modules.
- Inventory management (`inventory` module).

## Open questions / TODO
- This note is a stub — flesh out with actual page/feature inventory next time you work in this app.
- Document seller onboarding / merchant verification flow.
