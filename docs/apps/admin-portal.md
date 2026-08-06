# admin-portal

**Last reviewed:** 2026-08-06

Internal admin console. Lives at `apps/admin-portal`, Next.js, dev port 3000 (same caveat as [[seller-portal]] re: port conflicts when running multiple apps locally).

## Depends on
- [[../packages/ui]]
- [[../packages/catalog-contracts]]
- [[api]] — likely the primary consumer of `operations`, `audit`, and `merchant` modules

## Open questions / TODO
- This note is a stub. Fill in: what admin can see/do, which api modules it's the primary consumer of, auth/roles.
