# buyer-marketplace

**Last reviewed:** 2026-08-06

Public storefront — the buyer-facing marketplace app. Lives at `apps/buyer-marketplace`, Next.js, dev port 3000.

## Depends on
- [[../packages/ui]] — shared components
- [[../packages/catalog-contracts]] — shared types
- [[api]] — all data (search, cart, checkout, orders) comes from here
- `libphonenumber-js` — phone input/validation (checkout, WhatsApp contact)

## Known feature areas
- Search, filters, and pagination — see [[../SEARCH_OVERHAUL_AUDIT_AND_PLAN]] and phase audits for the current implementation and its history.
- Quick-filter navigation — recently converted from scrollable pills to nav-bar dropdowns (`QuickFilterRow`).
- Floating WhatsApp chat button for buyer support.
- Checkout — currently defaults to email OTP while Twilio SMS is degraded, see [[../decisions]].
- Responsive/device handling — see [[../RESPONSIVE_SYSTEM]].
- Buyer-local state (garage, recently viewed, etc.) is kept device-local — see dev-workflow memory for the specific storage keys.

## UX reference
[[../UX_AUDIT]] and [[../MARKETPLACE_TRANSFORMATION]] cover the eBay-Motors-style journey this app is modeled on.

## Open questions / TODO
- Map out the page/route structure (App Router layout).
- Document the buyer session/auth model vs seller/admin.
