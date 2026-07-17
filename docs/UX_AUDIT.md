# PartsBazar360 — UI/UX Audit

Audit of the buyer marketplace (`apps/buyer-marketplace`) and seller portal (`apps/seller-portal`),
based on a full code review of every page/component and a live review of
https://partsbazar360.realtrackapp.com. Findings are categorized by severity.
Each finding notes where it lives and how the redesign addresses it.

---

## 1. Critical — conversion & trust blockers

| # | Finding | Where | Resolution |
|---|---------|-------|------------|
| C1 | **Product page hides the product.** Title, brand, price context render *below* the gallery. On live listings the first image is frequently a donor-vehicle data sheet, so above the fold a buyer sees a document scan and an "Available Offers" box — no title, no fitment, no trust info. | `app/part/[id]/page.tsx` | New PDP: gallery left, buy box right with title, price, condition, fitment, part numbers, seller, and CTA all above the fold. Sticky mobile action bar. |
| C2 | **No fitment check against the buyer's own vehicle.** Fitment is the platform's core promise, yet the PDP only lists vehicles the part fits generically. Buyers must eyeball a table. | PDP + absence of vehicle context | New `garage-context` keeps an *active vehicle* on the device. PDP shows a first-class fitment verdict (verified / likely / check / no data) for that vehicle, with an inline picker if none is selected. |
| C3 | **Vehicle context evaporates.** Selecting a vehicle just produces a `/search?vehicleConfigId=` URL. Header, product, cart and checkout never remember it. | all pages | Persistent garage chip in the header; active vehicle threaded through search ("fits your …" mode), PDP, cart warnings, and checkout review. |
| C4 | **Fitment-mode search is degraded, not enhanced.** With `vehicleConfigId` set, sorting and filters disappear and all results render on one unpaginated page. | `app/search/page.tsx`, API contract | UI keeps the toolbar; results are windowed client-side safe; vehicle banner explains the mode with a clear exit. (Server-side pagination for fitment search is an API limitation — logged in LIMITATIONS.) |
| C5 | **"View on eBay" is a primary CTA.** A blue button (with a corrupt eBay SVG path) sends buyers to a competing marketplace mid-purchase. | PDP | Demoted to a small "source listing" reference link inside technical details. Broken SVG removed. |
| C6 | **Cart/checkout hide the two things buyers fear: fit and total cost.** No compatibility info in cart, no seller grouping, and shipping is never shown before placing the order ("calculated per-seller at checkout" — but checkout never shows it either). | `app/cart`, `app/checkout` | Cart groups by seller, shows condition and fitment status per line vs the active vehicle, and states shipping policy explicitly. Checkout gains a review step that restates vehicle compatibility and per-seller shipments before the order is placed. |
| C7 | **Checkout form is placeholder-only.** No labels (accessibility failure and a proven error-rate driver), no inline validation, no structure. | `app/checkout/page.tsx` | Labeled, validated fields with error recovery; two-step flow (details → review) with a proper success state. |
| C8 | **Currency displayed wrong.** Search cards format the indexed price with a `USD` fallback while the same part's offer panel shows `GBP` — identical number, different symbol. | `lib/format.ts`, OpenSearch index (no currency field) | Cards now format with the currency provided by offers; where the index provides none, the card shows the price without asserting a wrong symbol. Root fix (index currency) logged in LIMITATIONS. |
| C9 | **Facet counts contradict the catalog.** "10,000 results found" next to "General (283372)". Raw backend counts surfaced without interpretation. | search sidebar | Counts de-emphasized and used for ordering only where inconsistent; result count is the single source of truth in the toolbar. Root cause (facets computed over a larger corpus than the browse index) logged. |
| C10 | **"My Garage" is a single global mock user.** Every visitor reads and mutates the same server-side garage. Presenting that as "your garage" is misleading. | `garage.controller.ts` (mockUserId), garage page | The redesigned garage treats the device (localStorage) as the source of truth for *your* vehicles and active vehicle. The server garage API remains untouched for future auth. |

## 2. High — severe usability gaps

| # | Finding | Where | Resolution |
|---|---------|-------|------------|
| H1 | Header: no mobile menu at all (nav simply disappears), no category access, no search suggestions or recents, no garage/vehicle presence. | `components/Header.tsx` | Full header rebuild: utility bar, search with recent-searches dropdown, garage chip, cart, category rail, and a real mobile drawer. |
| H2 | Zero skeleton loaders. Client pages show bare "Loading…" text; SSR pages block with no streaming fallback. | everywhere | Skeleton system (`@repo/ui/skeleton`) + `loading.tsx` for search/PDP/home + per-component skeletons in garage, cart, seller tables. |
| H3 | Silent failure states. When the API is down, homepage sections vanish leaving blank bands; search shows "0 results" indistinguishable from a true empty set. | home, search | Distinct error surfaces ("couldn't load — retry") separated from true empty states with guidance. |
| H4 | Product card is information-poor: no condition, no seller, no fitment state (outside fitment mode), ambiguous "From" price, ALL-CAPS label collisions, category duplicated. | `components/ProductCard.tsx` | New card: image, condition + source badges, title (2-line), OE number when present, seller, fitment badge vs active vehicle, price with correct currency, offer count. |
| H5 | Pagination is Previous/Next only, no page numbers, no scroll context. | search | Numbered pagination with ellipsis, top-of-list anchoring. |
| H6 | Accessibility: unlabeled selects (VehicleSelector), placeholder-only inputs, icon-only buttons without names in places, color-only status, no skip link, heading level jumps. | global | Labels/aria across all forms, skip link, focus-visible ring tokens, badges carry text + icon (not color alone), consistent heading structure. |
| H7 | Compatibility table presents low-evidence data (expanded from listing titles) with the same visual weight as verified fitment. | `CompatibilityTable.tsx` | Evidence is now explicit: verified rows vs title-inferred rows are visually and textually separated; uncertainty is never hidden. |
| H8 | Support form asks for raw internal IDs ("Part ID optional") with no context of what's being asked about. | `app/support/page.tsx` | Redesigned form with labeled fields, category select, contextual banner when arriving from a part/order, proper success state. |
| H9 | Seller portal: `prompt()` for tracking numbers, fixed sidebar breaks all mobile use, no active nav state, dead `animate-in` classes (plugin never installed), unlabeled price inputs committing silently on blur. | seller portal | Responsive shell (topbar + drawer on mobile), active nav states, ship dialog replacing `prompt()`, labeled price editor with save feedback, skeletons and empty states. |
| H10 | Search relevance affordances missing: no OE-number hint, no recent searches, no category suggestions on empty query. | header search | Search overlay with recents (localStorage), category shortcuts and OE-number pattern hint. Server-side suggestion API logged as future work. |

## 3. Medium — consistency & polish

| # | Finding | Resolution |
|---|---------|------------|
| M1 | No design tokens: default Tailwind palette used ad hoc; blue-600 and emerald compete for "brand"; emerald means brand *and* success *and* seller-portal primary. | Shared preset (`packages/ui/tailwind-preset.cjs`): brand cobalt scale, graphite neutrals, semantic tokens, dedicated fitment-state palette; emerald reserved for success/verified. |
| M2 | Three radius languages (full pills, 2xl cards, lg buttons) with no rule; container paddings vary per page. | Radius scale with rules (buttons/inputs `rounded-lg`, cards `rounded-xl`, pills only for badges); `Container` spacing convention (`px-4 sm:px-6 lg:px-8`, `py-8/12` rhythm). |
| M3 | No typographic scale; `text-[11px]` micro-labels; prices in proportional figures; OE numbers in body font. | Type scale in preset; `tabular-nums` for all prices; monospace for part/OE numbers; minimum 12px for any text. |
| M4 | Icons are hand-pasted heroicon paths with mixed stroke widths and one corrupted logo path. | Single typed icon set `@repo/ui/icons` (24×24, stroke 1.8) used across both apps. |
| M5 | At least six ad-hoc button styles; disabled states vary (opacity vs gray fill). | `@repo/ui/button` variants (primary/secondary/outline/ghost/danger/dark) with unified hover/focus/disabled/loading states. |
| M6 | Footer: "Account" column links to Cart/Checkout; no support/trust content; no payment/shipping signals. | Rebuilt footer: shop/help/sellers columns, trust strip (fitment guarantee, returns, worldwide shipping), legal row. |
| M7 | Homepage: dated skew-transform hero, generic value props, text-only category chips, no how-it-works, no recently-viewed, empty bands when API fails. | New homepage: hero with vehicle finder + part-number search tabs, trust strip, iconed category grid, recent parts, how-it-works, seller trust band. |
| M8 | Dead code: `page.module.css`, unused Geist font files, unused turborepo stub components (`button/card/code`), README is turborepo boilerplate. | Removed/replaced. |
| M9 | Seller dashboards: `text-4xl` KPI numbers with no hierarchy, tables without responsive strategy, no pagination anywhere. | StatCard components, responsive table patterns (stacked cards on mobile where needed), consistent page headers. |
| M10 | `alt`/SEO: product JSON-LD exists (good) but images lack meaningful alt beyond title; no `aria-current` in pagination/nav. | Addressed across components. |

## 4. Information architecture (revised)

```
Buyer marketplace
├── Home ("find your part") — vehicle finder, search, categories, recent parts, trust
├── Search /search — toolbar (count·sort·vehicle chip) + filters (sidebar / mobile drawer) + cards + numbered pagination
├── Part /part/[id] — gallery · buy box (title→price→fitment→CTA) · fitment & evidence · specs · compat table · seller · shipping/returns
├── Garage /garage — device vehicles, active vehicle, add via finder (nickname/VIN), per-vehicle shop CTA
├── Cart /cart — seller groups, fitment status/line, summary, policy clarity
├── Checkout /checkout — details → review (compat confirmation, per-seller shipments) → confirmation
├── Support /support — contextual ticket form
└── 404 — recovery with search + categories

Seller portal
├── Dashboard — KPIs, priorities, quality model
├── Onboarding — stepper: legal → terms → submit
├── Pricing & terms — policy cards + quote calculator
├── Inventory — table w/ inline price edit + feedback
├── Uploads — import wizard + jobs + row review
└── Orders — fulfillment queue w/ ship dialog
```

## 5. Customer journey map (redesigned)

1. **Land** → hero states the promise ("exact-fit parts"); pick vehicle (Y/M/M/engine) or search by part/OE number. Trust strip immediately under hero.
2. **Identify vehicle** → vehicle saved to device garage; becomes *active*; visible in header chip on every page after.
3. **Discover** → search/category pages show fitment badges against active vehicle; filters narrow by category/brand; cards carry condition + seller + honest price.
4. **Evaluate** → PDP: fitment verdict for *your* car up top; evidence-graded compatibility below; condition grading, OE numbers (copyable), seller info, source disclosure; related parts.
5. **Decide** → offer comparison (multi-seller), add to cart with toast feedback; cart flags any line whose fitment isn't verified for the active vehicle.
6. **Purchase** → labeled address form → review step (items by seller, compatibility confirmation, totals + shipping policy) → place order → confirmation with clear next steps.
7. **Post-purchase** → confirmation links to support with order context; support tickets categorized (fitment/order/returns/payment).
8. **Return** → garage remembers vehicles; recently-viewed rail on home/PDP; recent searches in the search overlay.

## 6. Out of scope / requires business decisions

See [LIMITATIONS.md](./LIMITATIONS.md).
