# buyer-marketplace

**Last reviewed:** 2026-11-18

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
  actions remain visible and tappable; it returns to the bottom corner on
  desktop.
- Branded favicon — `app/icon.svg`, `app/favicon.ico` and `app/apple-icon.png` use
  the Hex P symbol on petrol (see [[../brand/partsbazar360-logo]]). The header and
  mobile drawer show the horizontal lockup from `public/brand/`, referenced with the
  `/buyer/` base path.

## 2026-10-12 listing image delivery

Buyer listing images continue to use the same `/img-proxy/` URLs. Requests for
the private inventory-image S3 host and approved inventory prefix are routed by
Nginx to the internal [[private-image-proxy]] service; other third-party image
hosts continue through the existing proxy. The private source bucket is not
made public.

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
fields, preview, publish, and delete posts. Blog bodies are stored as text.
The storefront renders simple headings, lists, and inline `[label](/path/)`
links as HTML elements. The shared blog-link parser accepts root-relative
paths and PartsBazar360 URLs, preserves queries and fragments, and displays
unsupported markup as text.

## 2026-10-09 buyer evidence and delivery states

The PDP fitment checker reads the API's decision for the selected vehicle and
clears the prior verdict while a new vehicle is checked. Compatibility-table
and broad MVL vehicle rows remain advisory; a green exact-fit label requires an
approved relationship source. Buyer DTOs omit seller identity, feed tags,
seller SKU, donor VIN/stock/location and internal fitment provenance.

Cart/checkout shipment labels are opaque and stable across cart and quote
responses. Unsupported, freight and explicit special-handling states show no
chargeable delivery total and prevent payment. Cart and checkout now store each
line's intended vehicle, show the server's current review decision, and require
acknowledgment only for no-vehicle or unverified lines. Checkout acknowledgments
survive a refresh only when a fresh validation returns the same opaque
fingerprint; a changed address, vehicle, coupon, currency, provider, price,
stock, shipping quote or fitment policy invalidates the saved choice. One PDP
purchase context drives desktop offer actions and the sticky mobile bar
(`lib/purchase-action-policy.ts`). Since 2026-11-18 it always shows **Add to
cart** and **Buy now** unless something definitely blocks the purchase: no
delivery to the chosen country, a freight or specialist-review quote, or a
known conflict with the selected vehicle. A missing destination shows "+
shipping at checkout", and an unconfirmed fitment (no vehicle, or a result
still loading) shows a short note under the buttons; checkout re-quotes
shipping and requires the server acknowledgment for those lines. The default
destination is the saved country, else the geo-detected country when it is in
the shipping list. PDP add/buy
actions send the selected canonical vehicle configuration to the cart;
adding the same offer for another vehicle creates a separate line. Cart review
and checkout continue to rely on server validation rather than this display
policy. PDP shipping quotes remain part-level, and device QA is still required
before release.

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
- eBay store CTA — the homepage hero, desktop utility navigation, and mobile menu use the
  supplied four-color logo through a shared component linking to `https://www.ebay.com/str/partsbazar360`.

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

**Last reviewed:** 2026-10-02

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
  menu use the supplied four-color eBay logo through one shared component,
  linking to `https://www.ebay.com/str/partsbazar360`. External navigation opens in a new
  tab with `noopener noreferrer`.
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

## Order tracking on purchase details

`/account/purchases/[id]` starts from the device-local order snapshot, then
fetches `GET /checkout/orders/:id` for live status. Signed-in buyers use their
bearer token. A guest can use the checkout session and token, but only in the
same browser tab: the order snapshot now stores `checkoutSessionId`, and the
token is in `sessionStorage`. The **Shipments & tracking** panel shows each
shipment's status, carrier, tracking ID and an http(s) **Track shipment**
link. Guests who can't fetch it see a prompt to sign in; tracking also goes
out by SMS and email when staff save it.

## Meta and TikTok advertising measurement

The storefront used a direct Meta PageView for pixel 873024462353915. The new
integration removes that tag and adds consent-gated Meta 1629408292294202 and
TikTok DBS6C7RC77U657ENO7K0. The GA4 ecommerce data layer and GTM container
remain in the storefront. Before cutover, inspect GTM and each Events Manager
for automatic or overlapping rules and retire any old storefront copies there.

Advertising is off until a destination is configured (`ADVERTISING_ENABLED`).
Once configured, measurement is **on by default (opt-out)** since 2026-11-15:
on the first status check `lib/advertising.ts` posts a consent grant for any
visitor without an existing grant, unless the `pb_ad_optout=1` cookie is set
or the browser reports `navigator.webdriver`. The footer link then reads
"Opt out of Meta and TikTok advertising measurement"; opting out revokes the
server grant, clears ad cookies and sets `pb_ad_optout` for a year so the
default grant is not re-applied. The APIs and the browser both honor that
choice. The browser loads the SDKs within a same-origin frame using
query-free section paths, without sending checkout-return parameters, product
slugs, or raw referrers. Search terms suggesting phone numbers, email addresses
or VINs are omitted. Automatic capture and advanced matching settings in the
ad accounts must be reviewed against the approved consent policy before
activation.

**Advanced matching (since 2026-11-15).** `setAdvertisingCustomer()` in
`lib/advertising.ts` normalizes and SHA-256 hashes customer details in the
storefront window, keeps only the hashes (memory + `sessionStorage`
`pb_ad_user`, cleared on opt-out) and sends them with each event to the pixel
frame, which passes them to `fbq('init', …)` and `ttq.identify()`. Raw details
never reach the frame. Sources: the signed-in account (email, phone, name,
user ID as `external_id`), the checkout submit (name, email, phone, city,
postal code, country) and a submitted support ticket (email, name, country).
Phones are only hashed when they carry a country code; guest placeholder
emails (`@guest.partsbazar360.com`) are skipped. The server events do the same
in the API; see [[api#Advertising delivery]].

| Browser event | Source | Server copy |
|---|---|---|
| PageView | Initial eligible load and committed storefront navigation | |
| ViewContent | Loaded product and visible offer, once on the product view | |
| Search | Loaded results for a submitted, eligible query | |
| AddToCart | Successful API mutation receipt | Yes |
| InitiateCheckout | New checkout-session receipt with cart contents | Yes |
| Purchase | Recent paid-order receipt tied to the same consent grant | Yes |
| AddToWishlist | Successful watchlist add | |
| Lead | Accepted freight support request | Yes |
| Contact | Accepted Ask about this part ticket, or phone/WhatsApp activation | |
| EbayStoreClick | Designated eBay store link | |

The part-page freight links and checkout freight links preselect the freight
category. Ask about this part uses the current support-ticket flow and tracks
when the ticket is accepted. Product view, wishlist and cart amounts use the
offer currency. Checkout uses the initial checkout currency and the item
subtotal. Purchase uses the paid order total (including shipping and discounts)
and immutable order line quantities and prices.

See [[api#Advertising delivery]] for configuration and rollback. Use the
approved vendor Test Events procedure before enabling the production flag. Compare browser and server event names and IDs for a successful
cart add, session, freight quote, and paid order. Check consent rejection and
withdrawal, repeated cart adds, paid confirmation refresh, and a failed payment
followed by a successful retry. A browser request and an API acceptance are
separate from dashboard receipt and provider deduplication.
