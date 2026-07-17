# PartsBazar360 Marketplace Transformation

Date: 17 July 2026

Scope: customer-facing buyer marketplace. Existing APIs, database models, seller operations, checkout service, cart service, search contracts, and vehicle data contracts were preserved.

## 1. Existing UI/UX audit

### Strengths retained

- Real catalog and listing data with product imagery, OE numbers, condition, source, and seller offers
- Guided vehicle configuration and a device garage
- Search facets, category and brand entry, sorting, pagination, and vehicle-scoped results
- Evidence-aware compatibility states and a detailed listing compatibility table
- Multi-seller cart and checkout service
- Guest checkout and support ticket service
- Product JSON-LD, server metadata, loading states, and image proxy support

### Critical gaps found

| Gap | Customer impact | Resolution |
|---|---|---|
| No watchlist | Buyers could not hold and compare marketplace listings | Added persistent watchlist context, listing/card actions, count, empty state, and route |
| No buyer account structure | Garage, cart, support, and checkout felt disconnected | Added account shell and overview with purchases, garage, watchlist, messages, returns, and settings |
| No purchase history or order detail | Checkout ended at confirmation | Real checkout responses are now saved on the device and presented as purchase history and order details |
| No explicit Buy now action | Listing actions did not match marketplace expectations | Added Buy now beside Add to cart while preserving the existing cart/checkout contract |
| Seller contact was indirect | Buyers could not easily ask a listing-specific question | Added Contact seller actions with part, seller, and subject context routed through the existing support service |
| No returns/disputes entry point | Post-purchase recovery depended on a generic form | Added order-scoped returns/issues path and escalation explanation |
| Header lacked full account journey | Purchases, messages, and watchlist were not primary global destinations | Rebuilt navigation around search, vehicle, categories, account, watchlist, cart, purchases, and help |
| Generic rounded-card appearance | The product felt like a familiar Tailwind template | Replaced the visual hierarchy with Workshop Ledger rules, squared technical surfaces, editorial rhythm, and restrained color |
| Homepage read as marketing | Search, vehicle, and catalog entry competed with generic claims | Rebuilt the first viewport around search, vehicle selection, category access, and honest marketplace trust signals |
| Remote Google font dependency | Production builds could fail or delay text | Removed the network font fetch and adopted a performant system stack |

## 2. Current eBay Motors customer journey map

The functional benchmark was checked against current eBay Motors and eBay buyer guidance:

- [eBay Motors category and My Garage entry](https://www.ebay.com/b/Auto-Parts-and-Vehicles/6000/bn_1865334)
- [Buying vehicles, parts, and accessories and Guaranteed Fit](https://www.ebay.com/help/buying/getting-started-ebay/buying-vehicles-parts-accessories?id=4639&ra=true)
- [eBay buying help: purchases, shipping, watchlist, feedback, and seller work](https://www.ebay.com/help/buying)
- [Contacting a seller](https://www.ebay.com/help/buying/contacting-seller/contacting-seller?id=4021)
- [Returns, missing items, and refunds](https://www.ebay.com/help/buying/resolving-buying-problems/refunds-returns?id=4008)

| Stage | Objective | Actions and decisions | Trust / evidence |
|---|---|---|---|
| Enter Motors | Start with a part, category, or vehicle | Search, My Garage, browse parts systems, view recent/watchlist | Marketplace identity and buyer guidance |
| Identify vehicle | Establish compatibility context | Add year/make/model/trim/engine; save; switch | Exact configuration stays visible |
| Discover | Reduce a large catalog | Query, autocomplete, category, filters, sorting, saved context | Corrected assumptions and visible applied scope |
| Compare listings | Choose among offers | Scan image, title, condition, source, seller, price, delivery, returns | Fitment, seller identity, and listing model remain distinct |
| Evaluate listing | Resolve purchase risk | Inspect images, OE number, compatibility, notes, condition, seller terms, shipping, warranty | Evidence source and uncertainty are explicit |
| Decide | Commit or defer | Watch, contact seller, add to cart, buy now | Buyer protection path remains visible |
| Checkout | Confirm the complete order | Review seller groups, vehicle fit, address, price, shipping, and terms | No hidden seller grouping; compatibility confirmation |
| Purchase management | Follow each seller shipment | Purchase history, order detail, tracking state, seller contact | Order and seller references remain attached |
| Resolve | Return or report an issue | Open request, work with seller, escalate to marketplace support | Listing and order context support the case |
| Close loop | Record experience and return | Feedback, repurchase, related search, garage memory | Persistent history and vehicle context |

## 3. Gap analysis against the benchmark

| Capability | Before | Implemented now | Backend dependency / honest limitation |
|---|---|---|---|
| Multiple saved vehicles | Partial | Complete device garage, active switch, edit, remove | Server sync awaits buyer authentication |
| VIN / plate lookup | VIN notes only | VIN can be stored for support and verification | Lookup service is not available in the current API |
| Autocomplete | Recent/category hints | Grouped recent, category, query, and part-number suggestions | Live product/brand suggestion endpoint is not available |
| Fitment continuity | Present but visually secondary | Persistent header rail plus listing/cart/checkout context | Exact confidence depends on seller fitment data |
| Watchlist | Missing | Functional device-local watchlist | Price-change notifications need a user/notification service |
| Auction / offer / classified | Missing | Not fabricated | Current offers are fixed-price inventory only |
| Seller ratings / feedback | Missing from data | Seller identity, location, dispatch, returns, and warranty shown when supplied | Rating/feedback fields and endpoints are not available |
| Buy now | Missing | Added | Uses the existing cart and checkout contract |
| Purchase history | Missing | Real checkout responses stored and rendered | Cross-device history needs authenticated buyer order endpoints |
| Tracking | Seller-operation data exists | Order detail explains per-seller tracking stage | Buyer-facing order lookup/tracking endpoint is not available |
| Messages | Missing | Account destination and listing/order-context contact flow | Persistent two-way threads need a messaging model/service |
| Returns / disputes | Generic support only | Order-scoped return and issue entry with seller-first escalation | Refund/dispute state machine is not available in the buyer API |
| Feedback | Missing | Journey location documented | Product/seller feedback data model and endpoint are not available |

No unsupported marketplace behavior is presented as complete. Where a backend contract does not exist, the UI either routes through the real support service or clearly labels the device-local boundary.

## 4. Premium ecommerce research summary

Baymard's current product-list benchmark reports that most desktop and mobile ecommerce sites still have serious product-list usability problems. The implemented response is to keep filters discoverable, show applied scope, preserve category-specific attributes, and retain sorting. See [Product List UX 2025](https://baymard.com/blog/current-state-product-list-and-filtering).

Baymard recommends an applied-filter overview and an explicit mobile apply action rather than disorienting live refreshes. PartsBazar360 retains its desktop sidebar, mobile filter drawer, and removable scope. See [Ecommerce filter UI guidance](https://baymard.com/learn/ecommerce-filter-ui).

Product-page research shows that buyers actively look for shipping and returns before checkout. The listing buy box therefore keeps seller origin, dispatch, returns, warranty, condition, fitment, and contact close to the price and actions. See [Baymard ecommerce UX statistics](https://baymard.com/learn/ux-statistics).

The synthesis also uses the strongest principles visible in premium retail and specialist parts stores: Apple's restraint and hierarchy, IKEA's task-first navigation, Back Market's condition clarity, Reverb's marketplace seller model, Tire Rack's vehicle-first context, FCP Euro's technical confidence, and RockAuto's catalog density. No single layout, brand asset, or component was copied.

## 5. Chosen visual direction and principles

**Workshop Ledger** combines:

- Near-black workshop ink for strong marketplace identity
- Petrol teal for fitment, information, and interactive hierarchy
- Safety orange only for vehicle and primary wayfinding
- Warm off-white paper/canvas surfaces
- Squared technical grids, divider rules, monospaced identifiers, and tabular price figures
- Real product imagery as the primary visual content
- Editorial variation between dense technical pages and more spacious confidence-building moments

The direction explicitly removes generic ecommerce-template patterns: no decorative gradients, glass cards, neon color, floating blobs, artificial metrics, fake urgency, repetitive feature cards, or unverifiable superlatives.

## 6. Updated information architecture

```text
Marketplace
├── Home: search, vehicle, systems, brands, recent listings, recent views
├── Search: query, vehicle scope, filters, sort, pagination, listing cards
├── Listing: gallery, fitment, offers, seller terms, watch/contact/cart/buy
├── Garage: multiple vehicles, active vehicle, nickname, VIN, edit/remove
├── Watchlist: watched listings and comparison holding area
├── Cart: items grouped by seller with fitment state
├── Checkout: details -> review -> confirmation -> purchase history
├── My PartsBazar
│   ├── Overview
│   ├── Purchases -> order detail -> contact / return
│   ├── Watchlist
│   ├── Garage
│   ├── Messages
│   ├── Returns & issues
│   └── Settings
└── Support: fitment, order, payment, returns, general listing/seller questions
```

## 7. Before and after

### Homepage

- Before: a conventional dark gradient-like hero, generic statistic cards, and a familiar rounded component stack.
- After: search and vehicle selection dominate the first viewport; marketplace evidence is compact; categories and brands behave as catalog entry points; product inventory is visible without scrolling through a marketing landing page.

### Search results

- Before: useful filters and cards, but the visual hierarchy still resembled a generic storefront.
- After: the Workshop Ledger header carries vehicle/category context; cards use structured technical surfaces; watchlist is immediate; seller/condition/part-number evidence stays in the evaluation path.

### Listing

- Before: strong fitment and seller groundwork but only Add to cart as the primary commercial action.
- After: watch, Buy now, Add to cart, and Contact seller follow the expected marketplace model; the mobile page keeps a sticky purchase action; uncertainty and provenance remain explicit.

### Account and post-purchase

- Before: absent after order confirmation.
- After: a coherent account system exposes purchases, order details, seller shipments, messages, returns/issues, garage, watchlist, and settings.

## 8. Preserved functionality

- All existing buyer routes and URL contracts
- Search, facet, part-detail, vehicle, cart, checkout, and support API contracts
- Device garage and active vehicle behavior
- Multi-seller cart/checkout backend
- Product images, listing provenance, compatibility evidence, and actual catalog data
- Seller portal and operations behavior
- Base path, standalone build, image proxy, sitemap, robots, JSON-LD, and metadata behavior

## 9. Removed redundancies and performance improvements

- Removed network-dependent Google font loading
- Replaced repeated marketing claims with shorter marketplace evidence
- Reduced decorative card use on the home, account, and footer surfaces
- Consolidated buyer destinations into one account navigation model
- Reused the existing support service for listing, seller, order, return, and dispute context instead of inventing separate dead-end forms
- Kept device-local data small and scoped: watchlist snapshots, purchase references, garage, and buyer preferences
- Added a bespoke optimized social-preview asset aligned with the actual brand direction

## 10. QA report

### Automated

- Next.js production build: pass
- TypeScript: pass
- Static and dynamic route generation: pass (16 buyer routes)
- No external font fetch in build: pass

### Browser and responsive

| Check | Result |
|---|---|
| 1440px home first viewport | Pass: search, vehicle, categories, actions, and trust hierarchy render correctly |
| 1280px search with 24 real catalog cards | Pass |
| 390px home | Pass: mobile header/search, vehicle rail, hero, and CTA hierarchy |
| 390px listing | Pass: gallery, fitment, watch, seller, Buy now, Add to cart, Contact seller, technical details |
| 320px search | Pass after overflow fix |
| 320px account | Pass after account-nav intrinsic-width fix |
| Document-level horizontal overflow | None at tested home, search, listing, and account widths |
| Watch -> header count -> watchlist -> remove | Pass with real listing data |
| Empty/error states | Verified on search, garage/vehicle load, watchlist, cart, purchases, and missing order |

### Known environment limitation

The standalone visual preview does not have the local API service attached, so its vehicle and catalog surfaces correctly render error states. The existing development environment was used to exercise real search listings, listing detail, and watchlist behavior. Checkout service integration remains covered by the successful production build and preserved API contract; a real payment confirmation was not executed during UI QA.

## 11. Journey-parity checklist

| eBay Motors-style stage | Status | PartsBazar360 implementation |
|---|---|---|
| Marketplace entry | Complete | Search, vehicle, category, brand, watchlist, recent listings/views |
| Vehicle selection | Complete for available data | Make/model/generation/configuration |
| Save/switch garage vehicles | Complete, device-local | Multiple vehicles, active state, edit/remove, VIN note |
| Search by name / part / OE | Complete | Header and home search; part-number recognition |
| Autocomplete mental model | Partial | Recent, category, query, part-number groups; live endpoint pending |
| Browse categories / vehicle | Complete | System grid, category rail, vehicle-scoped search |
| Filters / applied scope / sort | Complete for API facets | Sidebar, drawer, chips, category/brand, supported sorts |
| Listing comparison | Complete for supplied data | Cards expose fitment, condition, source, seller, part number, price |
| Fitment review | Complete | Persistent vehicle, verdict, evidence, compatibility table, notes |
| Condition review | Complete | Condition/source badges and actual-photo guidance |
| Seller credibility | Partial | Identity and supplied terms; ratings/feedback API pending |
| Shipping / delivery / returns / warranty | Complete where seller data exists | Offer terms and checkout seller grouping |
| Watchlist | Complete, device-local | Add/remove/count/index |
| Add to cart | Complete | Existing cart service |
| Buy now | Complete | Existing cart/checkout service |
| Contact seller | Complete through support service | Listing and seller context preserved |
| Checkout | Complete | Guest details, review, seller groups, fitment confirmation, order result |
| Purchase history / order detail | Complete on checkout device | Real checkout response storage |
| Tracking | Partial | Seller shipment structure shown; buyer tracking endpoint pending |
| Returns / issue / dispute entry | Complete through support service | Order-context request and escalation path |
| Feedback | Backend pending | Journey position documented; no fabricated control |

The result preserves the marketplace mental model without presenting unsupported auction, offer, feedback, rating, or tracking data as if it existed.
