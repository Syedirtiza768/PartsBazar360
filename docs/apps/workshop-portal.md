# workshop-portal

**Last reviewed:** 2026-08-06

Workshop/garage-facing app. Lives at `apps/workshop-portal`, Next.js, dev port 3000 (same port-conflict caveat as [[seller-portal]]).

Notably does **not** depend on [[../packages/catalog-contracts]] (only `@repo/ui`) — worth confirming whether that's intentional (workshop flows don't touch the shared catalog types) or a gap, next time this app is touched. See [[../decisions]] for the "Workshop Ledger" design direction referenced in [[../DESIGN_SYSTEM]].

## Open questions / TODO
- This note is a stub. Fill in what a "workshop" is in this domain and what this portal does for them.
