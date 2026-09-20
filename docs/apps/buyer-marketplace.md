# buyer-marketplace

**Last reviewed:** 2026-09-20

Public storefront — the buyer-facing marketplace app. Lives at `apps/buyer-marketplace`, Next.js, dev port 3000.

## Depends on

- [[../packages/ui]] — shared components
- [[../packages/catalog-contracts]] — shared types
- [[api]] — all data (search, cart, checkout, orders) comes from here
- `libphonenumber-js` — phone input/validation (checkout, WhatsApp contact)

## Ecommerce dataLayer contract

The buyer app emits the GTM ecommerce events `view_item`, `add_to_cart`,
`begin_checkout`, and `purchase` through `lib/ecommerce-tracking.ts`.
Product, cart, and checkout events use the API-backed canonical part ID/title
and convert offer prices into the currency the buyer is viewing or will be
charged in. Add-to-cart is emitted only after the cart POST succeeds.

The success page never builds a purchase from URL parameters or stale browser
history. It polls the authorized order endpoint and emits only the
server-produced `ecommerce` payload returned for a paid, successfully settled
order. A localStorage marker keyed by the backend transaction ID prevents the
same browser from pushing the purchase again on refresh; downstream GTM/GA4
should also use `transaction_id` as its idempotency key.

## Known feature areas

- Search, filters, and pagination — see [[../SEARCH_OVERHAUL_AUDIT_AND_PLAN]] and phase audits for the current implementation and its history.
- Quick-filter navigation - recently converted from scrollable pills to nav-bar dropdowns (QuickFilterRow).
- Taxonomy-page filters - category, system, brand, make, and model landing pages reuse
  the shared staged filter drawer and quick-filter row. The taxonomy node remains pinned in
  the browse query, refinements stay on the current taxonomy URL, and pagination preserves
  those query parameters instead of sending buyers to /search.
- Floating WhatsApp chat button for buyer support. On viewports below `lg`, it
  sits above the cart/PDP sticky action bar and the device safe area so both

## 2026-08-26 buyer policies and blog CMS

The buyer app now exposes /return-policy, /shipping-policy, /terms, and /blog
(all rendered under the app's /buyer base path). Return policy content carries
the production 14-day return statement plus eligibility, inspection,
shipping/refund, seller-responsibility, and contact clauses. Terms provide
general marketplace, order, acceptable-use, liability, UAE-law, and contact
clauses and should receive qualified UAE legal review before being treated as a
final legal agreement.

The shipping-policy page reads GET /policy/shipping. The API keeps the order
cutoff at 2:00 PM Gulf Standard Time (GST, UTC+4), derives handling days from
active offer/profile data, and falls back to the verified production listing
statement of three working days during a rolling schema transition. The live
production listing copy also identifies DHL, FedEx, and Aramex and worldwide
delivery to most countries.

The public blog is published-only: /blog and /blog/<slug> consume GET
/blog/posts and GET /blog/posts/<slug>. The admin portal's /blog CMS uses
authenticated admin CRUD endpoints to create drafts, edit slugs/content/SEO
fields, preview, publish, and delete posts. Blog bodies are stored as text with
limited heading/list rendering; arbitrary HTML is never injected.

actions remain visible and tappable; it returns to the bottom corner on
desktop.

- Guest-first checkout — SMS verification normally happens before
  delivery/payment; no password or login is required. Drafts survive refresh
  and payment failure, OTP supports paste/autofill/auto-submit, and account
  creation is offered only after payment. The temporary
  `CHECKOUT_OTP_BYPASS=1` deployment flag skips only this checkout challenge.
  See [[../CHECKOUT_GUEST_FIRST]].
- Checkout phone country codes are generated from libphonenumber-js metadata,
  so the selector includes every supported country/territory and validates
  local numbers against the selected calling code during normal OTP checkout.
  With CHECKOUT_OTP_BYPASS=1, the challenge is hidden and any non-empty
  phone-like value is passed through for recording without country/length
  validation; local input still receives the selected calling code.
- Checkout coupon entry — buyers must enter and apply a coupon code on the review step; the API revalidates it before payment.
- Cart shipping estimates are available to guests. The selected country is
  persisted immediately and carried into checkout, including restored checkout
  drafts; changing it invalidates the previous quote and refreshes shipping.
- Responsive/device handling — see [[../RESPONSIVE_SYSTEM]].
- Buyer-local state (garage, recently viewed, etc.) is kept device-local — see dev-workflow memory for the specific storage keys.
- Fitment badges show positive or incompatible states only; the uncertain state no longer renders a warning pill. Compatibility tables remain the source-agnostic vehicle evidence view.
- **PDP image gallery** (`ImageGallery.tsx`) deduplicates seller photos by normalising eBay size
  tokens and stripping query-param tracking variants; also filters SVGs defensively.
- Search and PDP image payloads exclude legacy `/api/search/parts/:id/catalog-image/:index`
  paths. Those paths have no deployed serving route and must not become the card's primary
  image; validated absolute media URLs are used instead.
- **PDP description rendering** (`sanitize-html.ts`) decodes HTML entities before injecting into
  `dangerouslySetInnerHTML` so encoded tags render as formatted text rather than raw source.
- **Verified product SEO view model** (`lib/product-seo.ts`) is the single derivation point for
  PDP titles, summaries, image alt text, technical specifications, canonical URLs, robots,
  BreadcrumbList/Product JSON-LD, and marketplace offer data. Product pages without a usable
  product image are rendered but marked `noindex`; Luna-reviewed image rows remain `noindex`
  until their `_seo` evidence says the exact image is a high-confidence match. MPNs are not
  rendered as OE numbers. The model uses catalog/enrichment fields only and does not infer
  vehicle fitment or technical values.

## Search/filter consistency contract (2026-08-24)

The buyer filter UI stages all multi-select changes through one shared
controller on desktop and mobile. Selections are OR within a facet and AND
across facets; counts are server-side previews of the same query that will be
applied. Applied chips and group summaries use the same price-label formatter,
and invalid or inverted price ranges cannot be applied.

The browse API treats source-tag and price constraints as nested offer-level
filters. When those refinements are active, price sorting uses the matching
offer price rather than the part-wide rollup, so result totals, visible card
prices, and low/high ordering remain aligned. Explicit `newest`, low-to-high,
and high-to-low sorts are not overridden by image availability.

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

**Last reviewed:** 2026-09-20

Public storefront — the buyer-facing marketplace app. Lives at `apps/buyer-marketplace`, Next.js, dev port 3000.

## Depends on

- [[../packages/ui]] — shared components
- [[../packages/catalog-contracts]] — shared types
- [[api]] — all data (search, cart, checkout, orders) comes from here
- `libphonenumber-js` — phone input/validation (checkout, WhatsApp contact)

## Known feature areas

- Search, filters, and pagination — see [[../SEARCH_OVERHAUL_AUDIT_AND_PLAN]] and phase audits for the current implementation and its history.
- Quick-filter navigation - recently converted from scrollable pills to nav-bar dropdowns (QuickFilterRow).
- Taxonomy-page filters - category, system, brand, make, and model landing pages reuse
  the shared staged filter drawer and quick-filter row. The taxonomy node remains pinned in
  the browse query, refinements stay on the current taxonomy URL, and pagination preserves
  those query parameters instead of sending buyers to /search.
- Floating WhatsApp chat button for buyer support.
- eBay store CTA — the homepage hero, desktop utility navigation, and mobile
  menu expose the local four-color eBay wordmark with a prominent link to the
  external store at `https://ebay.io/m/7vngBN`. External navigation opens in a
  new tab with `noopener noreferrer`.
- Guest-first checkout — SMS verification happens before delivery/payment; no
  password or login is required. Drafts survive refresh and payment failure,
  OTP supports paste/autofill/auto-submit, and account creation is offered only
  after payment. See [[../CHECKOUT_GUEST_FIRST]].
- Responsive/device handling — see [[../RESPONSIVE_SYSTEM]].
- Buyer-local state (garage, recently viewed, etc.) is kept device-local — see dev-workflow memory for the specific storage keys.
- Fitment badges show positive or incompatible states only; the uncertain state no longer renders a warning pill. Compatibility tables remain the source-agnostic vehicle evidence view.

## UX reference

[[../UX_AUDIT]] and [[../MARKETPLACE_TRANSFORMATION]] cover the eBay-Motors-style journey this app is modeled on.

## Open questions / TODO

- Map out the page/route structure (App Router layout).
- Document the buyer session/auth model vs seller/admin.

## SEO surfaces

Full detail in [[../SEO_ARCHITECTURE]]. What lives in this app:

- `lib/seo.ts` — the _only_ adapter: `Part` → engine input, `SeoDocument` →
  Next `Metadata`. Every page's metadata goes through `toMetadata()`, so no page
  can ship without a canonical or a robots directive.
- `app/parts/[slug]/` — the canonical PDP. `app/part/[id]/` is retained
  permanently as a one-hop 301.
- `app/parts/category/…`, `app/parts/system/…`, `app/brands/…`,
  `app/vehicles/…` — programmatic landing pages, all rendered by
  `components/TaxonomyLanding.tsx` so they inherit identical SEO.
- `app/sitemap.xml/`, `app/sitemaps/[file]/`, `app/robots.txt/` — runtime
  routes (a build-time evaluation previously baked `localhost` into production).
- `lib/product-specs.ts` — the PDP spec table. This is _presentation_; it was
  split out of the old `lib/product-seo.ts` (now deleted) so a display tweak and
  a metadata rule no longer share a file.

Catalog-hidden parts (`itemSpecifics._hiddenFromCatalog = true`) are excluded
from all public catalog surfaces and return a real 404 from the canonical PDP,
even when a visitor knows the exact slug. Their backend rows can remain active
for internal operational flows such as payment verification.

`lib/part-resolve.ts` degrades safely when the API has no `/seo/resolve` route
(mid-rollout or rollback): a UUID segment renders directly rather than 404ing.

## 2026-08-15 buyer navigation and compatibility update

The header consumes broad `categoryGroup` facets when they exist and falls back to real `category`
facets when the catalog has no classified groups. Fallback links use `/parts/category/<slug>` so
legacy or uncategorized inventory does not lead to empty system pages; the synthetic `Other` group is
not shown in the navigation rail. Compatibility tables omit source/verification labels and the
fitment badges are suppressed for check and unknown states so the UI does not show a warning pill.
