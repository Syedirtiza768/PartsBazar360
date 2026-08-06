# @repo/catalog-contracts

**Last reviewed:** 2026-08-06

Shared types/schemas for the parts catalog, consumed by [[../apps/api]], [[../apps/buyer-marketplace]], [[../apps/seller-portal]], and [[../apps/admin-portal]] (notably **not** [[../apps/workshop-portal]] — see that note).

This is the contract boundary between the backend and the frontends — changes here ripple across every app that imports it. Treat schema changes as cross-app changes, not local ones.

## Open questions / TODO
- Document the actual shape of the core catalog entities (part, listing, compatibility/fitment, brand) once you're working in here.
- Link this note to [[../MOTOR_PARTS_CATALOG_ARCHITECTURE]] entity-by-entity.
