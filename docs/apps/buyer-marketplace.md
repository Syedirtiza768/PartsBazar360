# buyer-marketplace

**Last reviewed:** 2026-08-12

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
- Guest-first checkout — SMS verification happens before delivery/payment; no
  password or login is required. Drafts survive refresh and payment failure,
  OTP supports paste/autofill/auto-submit, and account creation is offered only
  after payment. See [[../CHECKOUT_GUEST_FIRST]].
- Cart shipping estimates are available to guests. The checkout address country
  is authoritative and changing it refreshes the shipping quote.
- Responsive/device handling — see [[../RESPONSIVE_SYSTEM]].
- Buyer-local state (garage, recently viewed, etc.) is kept device-local — see dev-workflow memory for the specific storage keys.
- **PDP image gallery** (`ImageGallery.tsx`) deduplicates seller photos by normalising eBay size
  tokens and stripping query-param tracking variants; also filters SVGs defensively.
- **PDP description rendering** (`sanitize-html.ts`) decodes HTML entities before injecting into
  `dangerouslySetInnerHTML` so encoded tags render as formatted text rather than raw source.
- **Verified product SEO view model** (`lib/product-seo.ts`) is the single derivation point for
  PDP titles, summaries, image alt text, technical specifications, canonical URLs, robots,
  BreadcrumbList/Product JSON-LD, and marketplace offer data. Product pages without a usable
  product image are rendered but marked `noindex`; Luna-reviewed image rows remain `noindex`
  until their `_seo` evidence says the exact image is a high-confidence match. MPNs are not
  rendered as OE numbers. The model uses catalog/enrichment fields only and does not infer
  vehicle fitment or technical values.

## Product detail page enrichment contract

Image enrichment is the publish gate for the current Superior Auto Parts pass. A worker may
propose title, description, specifications, and an image, but production application requires
an exact product identity match plus direct image validation. Approved rows update the catalog,
search document, and page cache together; unresolved or contradictory rows remain in review.

The PDP retains UUID URLs for backward compatibility. Descriptive slugs can be introduced later
as redirects/canonical aliases after slug collision and legacy-link coverage are measured.

## UX reference
[[../UX_AUDIT]] and [[../MARKETPLACE_TRANSFORMATION]] cover the eBay-Motors-style journey this app is modeled on.

## Open questions / TODO
- Map out the page/route structure (App Router layout).
- Document the buyer session/auth model vs seller/admin.

**Last reviewed:** 2026-08-07

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
- Guest-first checkout — SMS verification happens before delivery/payment; no
  password or login is required. Drafts survive refresh and payment failure,
  OTP supports paste/autofill/auto-submit, and account creation is offered only
  after payment. See [[../CHECKOUT_GUEST_FIRST]].
- Responsive/device handling — see [[../RESPONSIVE_SYSTEM]].
- Buyer-local state (garage, recently viewed, etc.) is kept device-local — see dev-workflow memory for the specific storage keys.

## UX reference
[[../UX_AUDIT]] and [[../MARKETPLACE_TRANSFORMATION]] cover the eBay-Motors-style journey this app is modeled on.

## Open questions / TODO
- Map out the page/route structure (App Router layout).
- Document the buyer session/auth model vs seller/admin.

## SEO surfaces

Full detail in [[../SEO_ARCHITECTURE]]. What lives in this app:

- `lib/seo.ts` — the *only* adapter: `Part` → engine input, `SeoDocument` →
  Next `Metadata`. Every page's metadata goes through `toMetadata()`, so no page
  can ship without a canonical or a robots directive.
- `app/parts/[slug]/` — the canonical PDP. `app/part/[id]/` is retained
  permanently as a one-hop 301.
- `app/parts/category/…`, `app/parts/system/…`, `app/brands/…`,
  `app/vehicles/…` — programmatic landing pages, all rendered by
  `components/TaxonomyLanding.tsx` so they inherit identical SEO.
- `app/sitemap.xml/`, `app/sitemaps/[file]/`, `app/robots.txt/` — runtime
  routes (a build-time evaluation previously baked `localhost` into production).
- `lib/product-specs.ts` — the PDP spec table. This is *presentation*; it was
  split out of the old `lib/product-seo.ts` (now deleted) so a display tweak and
  a metadata rule no longer share a file.

`lib/part-resolve.ts` degrades safely when the API has no `/seo/resolve` route
(mid-rollout or rollback): a UUID segment renders directly rather than 404ing.
