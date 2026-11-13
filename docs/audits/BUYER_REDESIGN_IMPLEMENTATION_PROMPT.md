# PartsBazar360 — complete buyer marketplace implementation prompt

**Last reviewed:** 2026-09-17

Copy the prompt below into the implementation task. It is intentionally detailed and uses observable acceptance criteria. It does not authorize fabricated fitment, business policies, provider capabilities, customer reviews or inventory.

---

You are the lead product engineer, automotive catalog engineer, search engineer, UX designer and QA engineer responsible for implementing the complete PartsBazar360 buyer-marketplace redesign.

**Your task is to implement and verify the changes—not merely propose a plan, conduct another generic audit, create a mockup, or stop after improving the homepage.**

Work in the existing PartsBazar360 monorepo. Improve the actual buyer application, shared contracts, API, catalog/search pipelines and supporting operational workflows where necessary. Preserve existing functionality that already works. Deliver a coherent buying journey from discovery through repeat purchase.

The desired outcome is:

> A buyer can find the correct automotive part, understand the evidence that it fits, compare the complete offer, buy without unnecessary friction, and recover their order or resolve a problem afterward.

Implement all work that can be completed safely with the repository and available services. Where a feature depends on unavailable licensed data, real business-policy approval, production credentials or supplier operations, implement the complete integration boundary and truthful fallback, document the exact dependency, and keep the unavailable promise out of the live UI. Do not substitute fabricated data or claim the feature is operational.

## 1. Repository, scope and execution rules

### 1.1 Read before editing

Read the repository's `AGENTS.md` and any applicable nested instructions. Read `docs/Home.md` before non-trivial work. Then read:

- `docs/audits/BUYER_UX_CRO_AUDIT_2026-09-17.md` — the full audit behind this task.
- `docs/apps/buyer-marketplace.md`.
- `docs/apps/api.md`.
- `docs/packages/catalog-contracts.md`.
- `docs/DESIGN_SYSTEM.md`.
- `docs/RESPONSIVE_SYSTEM.md`.
- `docs/CHECKOUT_GUEST_FIRST.md`.
- Relevant search, filtering, catalog and SEO notes linked from the documentation map.

The default workspace is `F:\apps\PartsBazar360`. Use repository-relative paths internally so the work also runs on other systems. If a referenced file moved, locate its replacement and follow the actual code. Documentation can be stale or internally inconsistent: verify the active implementation before making a change.

Inspect Git status and preserve all pre-existing modifications. Never reset, clean, overwrite or reformat unrelated work. Do not modify secrets, production customer data or unrelated supplier exports. Do not commit large evidence screenshots, generated caches or private records accidentally.

### 1.2 Scope

This is an implementation task for the existing marketplace. Do not build a separate static website, parallel storefront, generic component demo or disconnected prototype. Do not introduce another hosting platform. Keep current canonical URLs, SEO behavior, redirect compatibility and usable catalog routes.

Use existing repository tooling, component primitives and conventions unless a specific deficiency requires a change. Inspect installed dependencies before adding new ones. Do not replace the search engine, authentication system or payment providers just because another tool is familiar.

Do not create a second implementation of search, filter serialization, price formatting, product identity, fitment verdicts or return-policy resolution. Identify the canonical implementation and consolidate consumers around it.

### 1.3 Autonomy and approvals

Make routine implementation decisions yourself. Do not repeatedly ask whether to continue. Complete authorized, reversible local work, migrations, fixtures, tests and documentation. Ask only when an unresolved business decision, missing external information or consequential action truly blocks the next dependency.

If blocked, ask a precise question identifying the affected deliverable and proceed with independent work. Do not let missing VIN-provider credentials block typo correction, mobile improvements or policy-component consolidation.

Do not send customer messages, trigger real OTPs, place live orders, charge/refund money, publish new policies, execute destructive production migrations or deploy to production solely to demonstrate completion. Use controlled fixtures and staging. If deployment is explicitly authorized, follow the repository deployment procedure; the documented deployment path uses `update.sh`, not a bare container rebuild.

### 1.4 Progress and handoff

Create a durable implementation checklist keyed to I01–I20 below. Record verified baseline, planned implementation, test evidence, remaining dependencies and status. Update it as work proceeds.

Send concise progress updates explaining completed behavior, findings and material blockers. Do not stop after a planning document or the first phase. Continue through all implementable scope.

Architecturally significant changes require updating the relevant documentation note and its `Last reviewed:` date before completion. Record non-obvious decisions and changed contracts. Do not bypass documentation checks without actually reviewing the documentation.

## 2. Known problems to reproduce before fixing

These were observed on 17 September 2026. Recheck them against the current branch/deployment; they are regression fixtures, not assumptions that production is unchanged.

1. Searching `2020 Toyota Land Cruiser front brake pads` returned one 2003–2007 front-right brake caliper without clearly saying the requested part was not found.
2. `brkae pads` returned zero results instead of useful spelling recovery.
3. `51118069942` returned three bumper listings; `04465` returned partial-number matches and autocomplete suggestions. Preserve these useful capabilities.
4. Homepage autocomplete rendered matched tokens with white text on a white panel.
5. Selecting Brakes applied `categoryGroup=Brakes`. Refresh retained it, but submitting a new header query discarded it. Browser Back restored the prior URL.
6. The vehicle picker exposed Toyota/TOYOTA, Audi/AUDI and other duplicate make/model variants, mixed generation ranges and individual years, and duplicate generation labels.
7. `FitmentBadge` returned nothing for `check` and `unknown`. The fitment evaluator could promote broad make/model/year table matches to verified without resolving engine/trim.
8. An aftermarket Delphi LP1305 page displayed “OEM LP1305” in its title. Its primary image completed with zero natural width and appeared broken.
9. The homepage displayed an internal payment-verification listing despite documentation saying it was hidden.
10. The homepage's brand section included part numbers and product-title fragments.
11. A BMW bumper description retained eBay checkout and messaging instructions inside PartsBazar360's purchase journey.
12. Cart/checkout advertised 30-day returns, the public policy described 14-day eligible returns, and the shared modal applied different restrictions to new and used parts.
13. A freight item still exposed ordinary Buy now before its shipping quote was resolved.
14. Mobile layouts placed the vehicle form below a long hero, truncated important product identifiers and allowed floating WhatsApp UI to overlap content.
15. The purchase list could load authenticated orders, but the order-detail route read only browser-stored orders.

Relevant starting points include:

```text
apps/buyer-marketplace/components/Header.tsx
apps/buyer-marketplace/components/HeroSearch.tsx
apps/buyer-marketplace/components/ProductCard.tsx
apps/buyer-marketplace/components/BuyBox.tsx
apps/buyer-marketplace/components/FitmentBadge.tsx
apps/buyer-marketplace/components/CartLineFitment.tsx
apps/buyer-marketplace/components/ReturnsPolicyNote.tsx
apps/buyer-marketplace/components/FilterSectionsClient.tsx
apps/buyer-marketplace/components/FilterDrawer.tsx
apps/buyer-marketplace/components/VehiclePicker.tsx
apps/buyer-marketplace/components/WhatsAppButton.tsx
apps/buyer-marketplace/lib/fitment.ts
apps/buyer-marketplace/lib/filter-params.ts
apps/buyer-marketplace/lib/use-search-suggestions.ts
apps/buyer-marketplace/lib/garage-context.tsx
apps/buyer-marketplace/lib/order-history.ts
apps/buyer-marketplace/app/search/page.tsx
apps/buyer-marketplace/app/checkout/page.tsx
apps/buyer-marketplace/app/checkout/success/page.tsx
apps/buyer-marketplace/app/account/purchases/page.tsx
apps/buyer-marketplace/app/account/purchases/[id]/page.tsx
apps/api/src/modules/search/
packages/catalog-contracts/
```

Use saved evidence in `outputs/ux-audit-2026-09-17/` if available. Do not treat the audit's temporary browser scripts as production tests; convert important cases into maintainable tests in the repository's normal test structure.

## 3. Completion checklist: all twenty workstreams

| ID | Required workstream | Priority |
|---|---|---|
| I01 | Correct search intent, constraints, ranking and result explanations | P0 |
| I02 | Shared, honest, evidence-backed fitment verdicts | P0 |
| I03 | Consistent effective return/warranty policy | P0 |
| I04 | Correct product identity, MPN/OE labels, provenance and condition | P0 |
| I05 | Central public-inventory eligibility and internal-item exclusion | P0 |
| I06 | Canonical vehicle taxonomy and simple vehicle selection | P1 |
| I07 | Reliable exact-product imagery and graceful failures | P1 |
| I08 | Clean seller descriptions and channel-specific instructions | P1 |
| I09 | Typo/synonym recovery and reliable accessible autocomplete | P1 |
| I10 | Predictable URL-backed filters and preserved search context | P1 |
| I11 | Transparent delivered costs, availability and freight quotes | P1 |
| I12 | Decision-focused product cards, comparison and PDP | P1 |
| I13 | Mobile hierarchy, navigation and collision-free controls | P1 |
| I14 | Guest checkout, identity, payment recovery and confirmation | P1 |
| I15 | Authorized persistent orders, tracking and guest recovery | P1 |
| I16 | Funnel/search-quality analytics and performance measurement | P1 |
| I17 | Curated homepage, brands and compatible merchandising | P2 |
| I18 | VIN/OE intelligence and grounded discovery integrations | P2 |
| I19 | Synced garage/saves, reordering and consented alerts | P2 |
| I20 | Workshop procurement, bulk entry and job carts | P2 |

P0 means correctness and purchase promises must be fixed before conversion experiments. P1 means essential commercial usability. P2 means the next capabilities required for the complete target product; do not silently omit them. Where P2 depends on external data or business operations, deliver integration-ready behavior with explicit activation gates and mark it honestly.

## 4. Shared data and behavioral contracts

Design these contracts before redesigning consumers. Extend existing shared types and schemas rather than creating unconnected UI-only models. The field names below express semantics; adapt them to repository conventions and provide migrations/adapters for existing callers.

### 4.1 Product identity

A product must distinguish:

- Canonical product identity and seller offer identity.
- Manufacturer/brand and its manufacturer part number.
- OE/OEM reference numbers, including their vehicle manufacturer and relationship type.
- Exact identifier, normalized formatting variant, validated equivalent, directional supersession, and unverified seller cross-reference.
- Product family/category, axle/position/side and package quantity/unit.
- Provenance: genuine vehicle-brand part, aftermarket, or unspecified. Track OE-supplier status separately when supported.
- Condition: new, used, remanufactured or explicitly unknown.
- Stock/price/delivery/returns belonging to the specific seller offer.

Do not infer genuine origin because provenance is missing. Do not turn an aftermarket MPN into an OE number. Do not assume interchange is symmetric or that a newer number fits every application of the older one. Preserve significant identifier characters and leading zeros.

Unique used items remain separate offers/assets even when they share a canonical OE identity. Photos, defects, test status and included pieces belong to the actual offered item.

### 4.2 Vehicle identity

Use stable IDs for canonical make, model, model year, market, generation/chassis, trim, engine and other discriminating configurations. Store aliases separately from canonical labels. Preserve real distinctions between imported markets, engine variants and production periods.

A garage vehicle can be incomplete. Record which attributes are confirmed, inferred or missing. The vehicle configuration is not fully resolved merely because a buyer selected a make/model/year.

### 4.3 Fitment verdict

Return one shared verdict with:

```text
state
partId / applicable offer or variant
vehicleId / vehicle configuration snapshot
evidenceIds
evidence source and version
resolved qualifiers
missing qualifiers
explicit exclusions
human-readable reason code
checkedAt
```

Use states equivalent to:

```text
NO_VEHICLE
CONFIRMED
NEEDS_DETAILS
UNVERIFIED
INCOMPATIBLE
UNIVERSAL_WITH_CONSTRAINTS
```

Map existing values deliberately and maintain compatibility while migrating. Never use a frontend-only heuristic to override a server-confirmed uncertainty state. Never promote missing evidence to confirmed or incompatible.

### 4.4 Search state

Keep raw input, interpreted input, hard constraints, soft preferences, correction explanation, applied facets, selected vehicle, sorting and pagination distinct. Suggested results and full results must use compatible interpretation and eligibility rules.

Each result should expose why it matched: exact number, formatting-normalized number, prefix, validated cross-reference, supersession, descriptive relevance or explicitly broadened alternative.

### 4.5 Effective offer and policy

The chosen offer must resolve:

```text
seller identity
condition and package contents
salable quantity / availability timestamp
item amount and charge currency
dispatch location
shipping eligibility and quote status
shipping amount / quote expiry
dispatch window and delivery window
effective return-policy ID and version
warranty scope / exclusions
```

Distinguish `not quoted`, `quoting`, `quoted`, `quote expired`, `quote required`, `unsupported destination` and `quote failed`. None of these may masquerade as free shipping.

Persist the accepted commercial facts and evidence versions on the order. An order receipt should not silently change when a seller edits tomorrow's policy.

## 5. I01 and I09 — search and autocomplete

### 5.1 Search pipeline

1. Normalize case, Unicode and harmless formatting while retaining the original string.
2. Detect exact/partial part number, descriptive part, vehicle query, brand/category and mixed intent.
3. Parse explicit year, make/model, engine, category, axle/position/side and number type into structured constraints.
4. Apply public-inventory eligibility before returning candidates.
5. Retrieve exact identities with highest precedence.
6. Retrieve validated replacements/cross-references in an explicitly labeled class.
7. Retrieve descriptive candidates with domain synonyms and controlled typo handling.
8. Enforce explicit hard constraints before representing a result as satisfying the request.
9. Rank eligible candidates using identity relevance, evidence, availability and useful offer quality.
10. When no strict candidate exists, return a truthful no-match response and separate proposed relaxations.

`brake pads` must not silently mean brake calipers, rotors or wear sensors. Related components may appear in a clearly separated complementary section. `front` must not silently include rear. An explicit 2020 vehicle must not silently become a 2003–2007 application.

Do not solve this with a hardcoded exception for the audit query. Build category/vehicle constraints and a representative regression set.

The repository contains more than one search implementation. Trace the active buyer/API routes and reuse existing parsing/ranking work where correct. Do not build a third disconnected stack.

### 5.2 Corrections and synonyms

- `brkae pads` should recover to brake pads and show the correction with an option to search the original text.
- Exact identifiers must not undergo silent fuzzy substitution.
- Number formatting normalization must preserve identity; manufacturer scope matters.
- Support sensible singular/plural and regional synonyms using a reviewed dictionary.
- Keep conflicting concepts distinct: pad/caliper, left/right, front/rear, set/individual, genuine/aftermarket.
- A zero-result response must distinguish no catalog match, no stock, incompatible vehicle, overrestrictive filters and service failure.
- Preserve the query and context in sourcing/support recovery actions.

### 5.3 Autocomplete

Use one shared behavior model for header and homepage search.

On focus, show the selected vehicle, up to five recent searches with removal/clear, and relevant category shortcuts. Never display another user's history. Popular searches, if present, must be based on real aggregate data and can be omitted when unavailable.

On input, show a stable panel with:

1. Search-this-query action.
2. Up to five strong product matches with image/fallback, readable title, complete identifier, match type and price where available.
3. Relevant vehicle/category refinements when they clarify intent.
4. See-all-results action with a reliable count when available.

`04465` must retain leading zeros and be labeled as a partial-number search. Do not imply every prefix match fits the active vehicle.

Correct the white-on-white highlighted text. Use proper combobox/listbox relationships, stable IDs, active descendant, visible focus, arrow navigation, Enter and Escape. Count every rendered option when handling keyboard navigation.

Abort obsolete requests when input changes, clears or becomes too short. Reject out-of-order responses using a request key or equivalent. Clear loading on non-OK HTTP responses and exceptions. Keep the user's input on errors. Do not display stale suggestions as if they match the current query.

### 5.4 Acceptance

Test exact known number, formatted equivalent, prefix, descriptive term, typo, synonym, make/model/year, engine-specific query, conflicting front/rear, unrelated category, no match, service error, fast typing, clearing during a request and keyboard-only use.

The original Land Cruiser pad query must produce correctly constrained candidates, a clarification, or an honest no-match state. Returning the old caliper as an ordinary match fails acceptance.

## 6. I02 and I06 — garage and fitment

### 6.1 Canonicalization

Create a reviewed alias mapping/deduplication pipeline for makes/models. Include dry-run output, collision reporting and a reversible migration strategy. Never delete configurations or merge distinct engines because their display labels match.

Merge superficial aliases such as case variants through canonical IDs. Reconcile broad model names and series names through hierarchy instead of flattening them blindly. Existing saved vehicles and deep links must continue resolving or show an explicit migration/reselection state.

Prevent newly imported bad aliases from reappearing by validating ingestion, not only sanitizing dropdown labels.

### 6.2 Vehicle picker

Default novice flow:

```text
Year → Make → Model → required distinguishing details
```

Ask engine, trim, market, body/brake variant, chassis or production date only when relevant. Offer “I don't know” and a verification route. Explain how to find the requested information. Never make a guessed default look confirmed.

Changing a parent clears invalid dependent values. Persist completed selections while moving back. Fetch dependent choices with cancellation and visible loading/error/retry states. Do not disable the entire experience indefinitely on one failed request.

Offer an inline picker on PDP/search that returns the buyer to their current context. Do not force navigation to a separate garage page and lose the product they were checking.

### 6.3 Garage

Support multiple vehicles, active vehicle, nickname, editing, removal and optional VIN/frame. Preserve anonymous local use. Add optional authenticated synchronization with a predictable merge/conflict strategy and no duplicate entries.

Switching the active vehicle must preserve the query, recalculate compatibility and visibly explain any change to the shortlist. An existing cart line must not silently be reassigned to the new active vehicle.

### 6.4 Fitment rules

- Confirm only against exact applicable evidence and all relevant qualifiers.
- Year/make/model overlap alone is insufficient where engine/trim/production differences matter.
- Prefix matching on model names is not proof of the same model.
- Show `Needs engine details` or another precise missing attribute rather than vague confidence percentages.
- Show unverified neutrally; never suppress it to make the page look reassuring.
- Incompatible requires explicit conflicting evidence; absence of a row is not negative proof.
- Universal parts still disclose dimensions/connectors/application limits.
- Source/version/evidence details are accessible without overwhelming the main buying surface.

### 6.5 Placement and cart behavior

Show an appropriate fitment state in suggestions, cards, results, PDP, cart and review. With no vehicle, show a check-fit action. On cards and PDPs, name the active vehicle when the verdict is personalized.

Cart lines support vehicle assignment independently. A mechanic can buy for multiple vehicles. Known incompatibility prevents accidental purchase for the assigned vehicle, but allow deliberate reassignment or a clearly explained “buying for another application” route where appropriate. Do not imply that a checkbox changes the underlying fitment evidence.

Support verification requests must carry current part/offer and vehicle context and return a durable verification record. Do not send support messages during automated tests.

### 6.6 Acceptance

Test exact compatible, same model/different engine, production split, model-prefix collision, missing evidence, explicit exclusion, incomplete vehicle, universal dimensions, mixed-vehicle cart, switching garage vehicle and importing legacy saved vehicle IDs.

Verify the same verdict appears across card, PDP, cart and checkout. A failed lookup stays unverified with retry; it must not turn green.

## 7. I03, I04 and I08 — product truth and policies

### 7.1 Product naming and provenance

Construct titles and identifiers from typed facts. Example:

```text
Delphi Front Brake Pad Set — LP1305
Brand: Delphi
Manufacturer part number: LP1305
Origin: Aftermarket
Condition: New
```

Only include “Front” and “Set” if validated for that product. If they are unknown, omit them or request enrichment; do not fabricate them to satisfy a template.

Display validated OE references separately from manufacturer number. Remove automatic defaults to genuine origin. Replace duplicated “New / New Aftermarket” and “Used / Used Genuine OEM” badges with one understandable condition/origin line.

Preserve the distinction in metadata, structured data, cards, PDPs, cart, order snapshots and search index. Fixing only visible copy while leaving contradictory SEO/search fields is incomplete.

### 7.2 Descriptions

Preserve raw source content for provenance/audit where appropriate, but render clean marketplace-specific product facts. Remove external-channel payment, messaging, shipping and return instructions from the purchase description. Use structured local offer/policy modules instead.

Keep legitimate technical facts, condition disclosures and included/excluded items. Sanitize imported HTML. Do not strengthen seller claims into platform guarantees. “Tested” must disclose the test scope when available; missing scope must remain apparent.

Use a repeatable ingestion/normalization rule and review queue, not a one-off edit to the sampled BMW page.

### 7.3 Returns and warranty

Find every return/warranty claim in UI, static policy pages, imported descriptions, seller profiles, cart, checkout, messages and receipts.

The audit identified conflicting 14-day, 30-day and new/used restrictions. **Do not choose the legal/commercial rule yourself.** Locate an authoritative approved policy; if there is none, ask the business owner the exact unresolved questions while implementing the policy resolver and eliminating unsupported universal claims.

The resolver must produce the effective rule for the selected offer and destination where applicable. Include eligibility, window, exclusions, return-shipping responsibility, process and warranty separately. Display the same resolved meaning everywhere and snapshot the accepted version on the order.

When policy data is missing, show “Return terms need confirmation” with a clear resolution path. Do not quietly enable a purchase under fabricated protection. Whether an unresolved-policy offer remains purchasable requires an explicit business rule; fail closed for claims, and flag the operational decision.

Do not announce a new fitment guarantee, delivery guarantee, authenticity certification or buyer-protection program without real operational eligibility and remedy rules.

### 7.4 Acceptance

Test new aftermarket, new genuine, used genuine, remanufactured and unspecified origin. Confirm manufacturer number and OE labels remain correct in every surface. Test conflicting/missing seller policies, policy-version changes after purchase and mixed-seller carts. The receipt must preserve the purchase-time policy.

## 8. I05 and I07 — public catalog eligibility and imagery

### 8.1 Publishability

Create one authoritative public eligibility rule. It must exclude internal/test/hidden/deactivated offers and respect catalog visibility decisions. Apply it to browse, search, suggestions, homepage feeds, brand/category counts, related parts, recommendations, sitemap/SEO outputs and relevant caches/index documents.

Distinguish public discovery exclusion from any explicitly retained internal test-access mechanism. Do not expose operational test products through arbitrary public recommendation paths. Preserve authorized payment-verification workflows without advertising their fixture as merchandise.

Update index/cache propagation so changing eligibility removes items consistently. Add tests covering stale cache/index transitions. Do not rely only on client-side filtering: counts, suggestions and SSR must also agree.

### 8.2 Media

Validate image identity, reachability and content type. Support owned/licensed supplier media and existing proxy rules. Do not scrape or copy images without appropriate rights. Do not create AI images pretending to depict the actual part.

Give images fixed layout dimensions, proper object fitting and useful alt text. If loading fails, show a designed fallback with “Photo unavailable” and a verification/photo-request route where useful. Never leave a giant broken-image region or raw alt text as the primary gallery.

Deduplicate source variants. Label actual used-item photos versus representative catalog imagery. For used items require relevant angles/defects through the seller publishing workflow or review gate.

Use sensible quality-based merchandising without overriding an explicitly chosen price sort. A matching low-price item must not move out of price order merely because another item has a better photo.

### 8.3 Acceptance

Internal fixtures never appear in public discovery/counts. Hidden status propagates to cache/index. Simulate 404, timeout, invalid content type and duplicate media; gallery/cards remain stable. The LP1305 failure must display a graceful fallback and the underlying source problem must be repaired or quarantined, not hidden behind a spinner.

## 9. I10 — filters and navigation state

Keep the existing staged controller, OR-within/AND-across behavior and price-range validation where correct. Consolidate shared URL serialization. Do not introduce per-component ad hoc parameter handling.

### 9.1 Facets

Provide category-relevant groups in this order:

1. Vehicle configuration.
2. System/category/component and position/side.
3. Origin: genuine/aftermarket/unspecified.
4. Condition.
5. Brand.
6. Availability, delivery date/speed and pickup when actually supported.
7. Price with explicit currency and price basis.
8. Seller and dispatch location.
9. Advanced exact/replacement number matching.

Hide empty irrelevant groups, but retain selected zero-count values so they can be removed. Do not present internal source codes as buyer-facing inventory categories. Separate provenance from component type in the schema and labels.

### 9.2 State behavior

- Applied state lives in the URL; pending selections remain separate until Apply.
- Refresh and a copied URL recreate the same query, facets, sort and vehicle scope.
- Back/Forward restore state and useful scroll position.
- Applying a filter resets pagination, not unrelated context.
- Editing the query retains the selected vehicle and destination.
- Retain relevant user-selected refinements; clear incompatible category-specific ones with an explanation.
- An explicitly selected brand should not disappear silently. Offer a visible clear/reset action.
- `Clear filters` preserves query/vehicle/destination. `Reset search` has a separately defined behavior.
- Taxonomy scope stays pinned until an explicit Search all parts action.
- Price facets and sorting operate on the same eligible offers as displayed card prices.
- Counts use the same query/eligibility logic as results.
- Draft counts expose loading/error state and reject stale responses.

Desktop: compact relevant quick filters plus an all-filters sheet. Mobile: full-height drawer with group list/drill-in, accessible close/back and a fixed Reset/Show N footer. Opening/closing restores focus. Keep draft retention behavior explicit and consistent.

Remove implementation prose such as “same staged selections as the quick filters and sidebar” from the buyer UI.

### 9.3 Acceptance

Test two brands, category plus price, remove chip, selected zero-count option, clear/reset, inverted range, page reset, sort, currency changes, taxonomy scope, mobile close/reopen, copied URL, refresh, Back from PDP, Back after Apply and editing the query. Assert result IDs/counts as well as URL and chips.

## 10. I11 and I12 — cards, offer comparison, PDP and freight

### 10.1 Product cards

Use this hierarchy:

```text
Exact image / intentional fallback + Save
Plain product title
Fitment state for selected vehicle
Condition · origin · package basis
Manufacturer number / exact match reason
Price and unit or set basis
Availability / destination-based delivery
Seller + concise return eligibility
View part / Choose offer / safe quick add
```

Avoid repeated badges, raw source abbreviations and redundant metadata. Important identifiers must be readable or easily expanded/copied. On narrow screens offer a compact list view suited to number comparison.

Use quick add only when required variant, offer, quantity basis and fitment context are resolved. Multiple offers require a deliberate offer choice. Do not encourage accidental purchase of an uncertain variant.

### 10.2 Comparison

Support comparison of up to three compatible product alternatives using brand, origin, condition, included quantity, fitment, availability, delivered price, warranty and returns.

Compare sellers of the same canonical product separately from comparing different products. Keep unique used-item photos/condition visible. Mark information that is missing; do not fill gaps with invented equivalence.

### 10.3 PDP hierarchy

Implement:

1. Back-to-results restoring state, breadcrumb and vehicle context.
2. Product identity and functional photo gallery.
3. Fitment verdict and precise missing-detail/verification action.
4. Selected offer, seller, salable availability, quantity basis, price and destination.
5. Delivery/quote and total-cost summary.
6. Effective return/warranty summary.
7. Quantity and primary buying action.
8. What arrives: pieces, hardware/sensors included/excluded, packaging and defects.
9. Structured category-specific specifications with units.
10. Compatible vehicles and validated OE/supersession relationships.
11. Seller information, actual verification scope and real service/review evidence.
12. Clean product description and licensed diagrams where useful.
13. Confirmed compatible alternatives and optional related components.

On desktop, use a useful sticky purchase panel without trapping scrolling. On mobile, show a safe-area-aware price/action bar after the main action scrolls away. Avoid duplicated sticky controls.

### 10.4 Shipping and availability

Ask destination early enough to produce useful estimates. Distinguish warehouse stock from supplier-available/sourced-to-order inventory. Show dispatch and delivery as different concepts. Never claim UAE-local stock from seller address alone.

Before quote: “Items subtotal—shipping not yet included.” After quote: item amount, shipping per seller shipment, applicable tax treatment and final charge amount/currency. Remove merchant-settlement implementation terminology from the buyer-facing flow.

Delivery promises must use actual seller handling, cutoff, destination and service capability. Show uncertainty honestly. Do not label a stock count as reserved merely because an item is in the cart.

### 10.5 Freight

For freight-required items, make Request delivery quote the primary action. Capture part/offer, quantity and destination in a resumable quote cart. Store quote amount, scope, currency, expiry and status. A resolved valid quote enables checkout.

In mixed carts, explain separate shipments and allow the buyer to purchase courier-ready items separately or wait for the freight quote. Do not silently split or place orders.

Do not leave a normal Buy now button leading to a late disabled Pay state. A quote failure must have retry/support/resume options without losing the cart.

### 10.6 Acceptance

Test single/multiple offers, package quantities, stock changes, unknown delivery, expired quote, unsupported destination, freight-only and mixed carts. Test used-item defects and missing specs. Related items for a selected vehicle must not be random cross-vehicle fillers.

## 11. I13 and I17 — homepage, visual system and mobile

### 11.1 Homepage

Implement this order:

1. Compact header with dominant universal search and cart.
2. Clear value statement plus one primary search task and Choose my vehicle.
3. Resume active vehicle/job if present.
4. Common understandable part categories.
5. Relevant publishable inventory for the selected vehicle/destination.
6. Recently viewed and saved parts when there is history.
7. Concrete service/evidence explanation.
8. Curated canonical brands.
9. Support, policies and legal business identity.

Suggested wording: “Find the right part for your car.” Supporting text: “Search by part number, part name or vehicle. Compare condition, delivery and seller terms before you buy.” Adapt only to verified capabilities.

Replace “Set your fitment context” with plain vehicle-selection language. Do not populate featured brands from unvalidated raw fields. Do not prioritize newest records regardless of eligibility/photo/identity quality.

Keep external-store access secondary. Retain a measurable external link if commercially required, but do not give it the same prominence as the marketplace's primary purchase task.

### 11.2 Visual direction

Retain an automotive identity using charcoal, warm neutrals, restrained teal and a clear action accent. Consolidate tokens and components. Avoid generic SaaS dashboards, decorative gradients, giant empty cards, excessive borders and unnecessary animation.

Use readable sans-serif body/product text; keep condensed display typography for limited headings. Critical fitment/returns/price information must not use tiny all-caps text. Maintain adequate contrast, visible focus and non-color state labels.

Use predictable spacing and minimal elevation. Preserve useful density for mechanics while making novice decisions understandable. Product photos serve identification, not decoration.

### 11.3 Navigation

Desktop: logo, search, vehicle, saved, account/orders and cart; compact category navigation. Put less frequent destinations inside appropriate menus.

Mobile browsing: header/cart, compact search, vehicle summary; bottom Home/Search/Garage/Saved/Account if it improves usable space. On PDP/cart replace browsing bottom navigation with the purchase action. Checkout has its focused actions, not three stacked bars.

### 11.4 Mobile requirements

- At 390 × 844, the first screen must expose search and a clear vehicle-entry action without the current long explanatory hero.
- Support 320/360/390/430 widths without document-level horizontal overflow.
- Avoid truncating critical selected vehicle, price and identifier information without recovery.
- Prevent WhatsApp/support UI from covering cards, inputs, validation, filter footer or purchase controls.
- Respect safe-area insets, zoom and software keyboards.
- Use touch-friendly controls; target approximately 44–48 CSS pixels where appropriate.
- Search and filter overlays trap/restore focus appropriately and close predictably.
- Galleries support touch/swipe/zoom without relying on hover.
- Respect reduced motion and avoid moving controls under the pointer.
- Test long labels and RTL if Arabic is supported; do not fake translations or claim localization coverage not implemented.

### 11.5 Acceptance

Capture representative desktop/mobile screenshots of homepage, suggestions, results, filter sheet, vehicle picker, PDP, cart, checkout and orders. Inspect them. Do not claim responsive QA merely because the build passes.

## 12. I14 — cart, checkout, payment and confirmation

### 12.1 Cart

Group items by seller/shipment. Each line shows identity, actual condition, quantity basis, assigned vehicle/fitment, price, availability and return eligibility. Provide remove with Undo and save for later. Quantity changes must be server-confirmed and failure-safe.

Destination and shipping status remain visible. Persist the selected destination into checkout. A changed destination invalidates the old quote and triggers a new one.

### 12.2 Checkout architecture

Keep progressive guest checkout:

```text
Details → Review → Hosted payment → Confirmed/pending/failed result
```

Do not require account creation or a password before purchase. Do not switch to a drawer-based checkout. Use a focused shell with logo, secure return to cart and relevant support, reducing unrelated navigation.

### 12.3 Form behavior

- Phone: country-aware input, truthful order-update/verification explanation and validation.
- Name: one full-name field.
- Email: optional receipt field unless a documented operational requirement proves otherwise.
- Address line 1: appropriate country-specific label and autofill.
- Address line 2: optional progressive field.
- City/emirate/state: use meaningful country-specific fields without redundant mandatory input.
- Postal code: required only where destination/carrier rules require it; do not force invented UAE postal codes.
- Country: carries forward from cart and re-quotes on change.
- Payment: show only configured and eligible methods with real charge currency and amount.
- Coupon: collapsed optional entry, explicit Apply, server-validated discount and retry persistence.

Focus the first invalid field and offer an accessible error summary. Preserve draft input through refresh, quote failures, expired sessions and provider cancellation as permitted by the privacy/session model. Keep checkout PII out of analytics and unnecessary persistent browser storage.

### 12.4 OTP/identity

Inspect the documented checkout OTP bypass and the actual deployment/build behavior. Do not call an unverified number verified. Retain proper country/phone validation and checkout-scoped authorization.

Implement and test paste/autofill, expiration, retry limits, resend cooldown, changed phone, provider outage and draft retention. Use test-provider fixtures. Do not send real OTPs during unattended testing.

### 12.5 Payment

Preserve server-side offer/stock/shipping revalidation and stable order idempotency. Duplicate clicks/retries must not create duplicate paid orders. After a timeout, look up the existing attempt/order before initiating another payment.

Support success, decline, cancellation, pending and unknown provider state. The UI must distinguish them. A lost redirect or delayed webhook must not imply payment failure and invite a duplicate charge.

Card/Tamara labels must reflect actual configuration/eligibility. Add wallet/express flows only when the existing provider supports them and they are configured/tested. Do not add fake payment logos or unimplemented buttons.

### 12.6 Confirmation

Only server-confirmed paid status produces Order confirmed. Pending status explains that the payment is being checked and provides a safe return/refresh path. Failed status offers a retry using the same logical order.

Show order number, amount/currency, receipt, shipment count, expected delivery information, purchased identity/condition and support. Offer account creation/sync after successful purchase; it remains optional.

### 12.7 Acceptance

Test form validation, autofill, draft restoration, country changes, coupon invalidation, OTP states, price/stock change, freight quote expiry, duplicate click, provider decline/cancel, lost redirect, delayed webhook and duplicate webhook. Verify purchase analytics fires only on authoritative paid state and is deduplicated.

## 13. I15 and I19 — orders, recovery and retention

### 13.1 Persistent order details

Fix the account-list/detail mismatch. The detail route must retrieve the order from an authorized server endpoint, not depend solely on browser storage. Use local snapshots only as a clearly stale/offline aid, not the source of current payment/tracking truth.

Enforce ownership and role authorization. An order ID is not authorization. Show loading, denied, missing, offline and retry states distinctly without leaking another buyer's data.

### 13.2 Guest recovery

Provide a secure guest-order recovery flow based on the approved contact verification model. A buyer should recover an order on another device without creating an account. Avoid account-enumeration leaks and protect lookup attempts. Do not implement public order access based only on a guessable identifier and email.

### 13.3 Tracking, returns and support

Show per-seller shipments with real events/carrier links when available. Distinguish awaiting dispatch, shipped, delivered, delayed and unavailable tracking. Do not render a decorative timeline as if events occurred.

Returns/support launch with order/line context and applicable purchase-time terms. Display case status and responsible owner where supported. Keep the buyer from retyping part, vehicle and order details.

### 13.4 Reorder and saved state

Implement buy again with current price, stock, quantity basis and identity checks. Clearly explain superseded/replaced/unavailable items. Do not silently substitute a different brand, condition or application.

Synchronize garage and saved parts/searches optionally for authenticated buyers, preserving anonymous use and an explicit merge policy. Implement recently viewed consistently and exclude hidden/internal items.

### 13.5 Alerts

Add explicit opt-in saved-search, back-in-stock and meaningful price-drop subscriptions. Price comparisons must refer to the same identity, condition and quantity basis. Deduplicate notifications and support unsubscribe/preferences.

If no notification provider is configured, implement the subscription/event/outbox/delivery interface and show a truthful availability state. Do not send messages or claim delivery success. Avoid daily noise when nothing actionable changed.

Maintenance reminders require buyer preferences and relevant service/mileage data. Do not infer a maintenance schedule from one order.

### 13.6 Acceptance

Test order lookup on a fresh browser, authenticated list-to-detail navigation, unauthorized access, stale local state, guest recovery, partial shipments, return initiation, reorder price/stock changes, anonymous/account merge and alert deduplication/unsubscribe.

## 14. I18 — VIN, OEM intelligence and assisted discovery

Implement as provider-backed capabilities with explicit coverage, not a free-text box that pretends to verify anything entered.

### 14.1 VIN/frame

Define a provider interface returning decoded fields, market/coverage, source, timestamp, confidence/uncertainty and missing attributes. Validate input appropriately for supported VIN/frame types; do not assume all regional chassis numbers are 17-character VINs.

Let the buyer confirm the decoded vehicle. VIN decoding is not part fitment; feed the confirmed configuration into the fitment evidence system.

Cache where licensing allows, redact sensitive input from generic logs/analytics and provide manual vehicle entry when coverage is unavailable. If credentials/data rights are unavailable, implement contract tests against fixtures and leave real lookup disabled with an honest fallback.

### 14.2 OE/interchange graph

Model exact identity, manufacturer scope, validated replacement, directional supersession and seller-asserted relationship separately. Store source and applicable qualifiers. Never transitively infer universal compatibility from a chain of unverified cross-references.

Show why an alternative is offered and which vehicle restrictions apply. Expert search may show the graph compactly; novice UI should translate it into a plain explanation.

### 14.3 OCR/visual/AI assistance

OCR can extract candidate label numbers; require confirmation of ambiguous characters. Visual search can propose a category or candidate, never prove fitment from appearance.

An AI assistant must retrieve actual catalog/offer/evidence records, show or reference the match basis and ask for missing constraints. It must not invent part numbers, stock, shipping dates, reviews, genuine status or warranties.

Do not make conversational AI the mandatory search entry. Preserve fast deterministic expert search and manual navigation.

License-plate lookup remains disabled unless a licensed, legally appropriate provider and market coverage are confirmed. Implement no speculative scraper or unauthorized registry access.

### 14.4 Acceptance

Test supported/unsupported VIN, regional frame format, provider failure, ambiguous decode, wrong-market configuration, conflicting cross-references, directional supersession and AI/OCR uncertainty. Every confirmed-fit output must remain backed by the same evidence contract used elsewhere.

## 15. I20 — workshop procurement

Build a usable workflow in the existing account/workshop architecture; do not create a second disconnected B2B application.

Support:

- Bulk paste/upload of part number and quantity.
- Explicit manufacturer scope or clarification when numbers collide.
- Per-line exact/replacement/no-match status.
- Candidate confirmation before cart creation.
- Job carts with job reference, optional customer-vehicle assignment and quantity.
- Multiple vehicles in one procurement session without overwriting global garage context.
- Current stock, dispatch and seller shipment comparison.
- Saved/repeated jobs with current price/availability revalidation.
- Purchase-order reference and invoice access where supported.
- Team permissions appropriate to buyer/approver/admin roles if those workflows are activated.

Do not invent wholesale prices, credit terms, tax documents or approval authority. Use configured business rules; document missing commercial decisions. Ensure workshop customer data is separated from an employee's personal garage and access is scoped correctly.

Acceptance: paste a mixed list of exact, ambiguous, unavailable and replacement numbers; resolve candidates; assign two vehicles; change quantities; review shipments; save/resume; reorder with changed stock; verify unauthorized team members cannot access restricted jobs/orders.

## 16. I16 — analytics, speed and quality measurement

### 16.1 Analytics

Preserve existing ecommerce events and authoritative purchase payloads. Add or consolidate events for:

```text
search_submitted
search_interpreted
suggestion_selected
search_results_viewed
zero_results
filter_applied
vehicle_selected
fitment_state_viewed
verification_requested
shipping_quote_shown
checkout_step_completed
payment_attempt_result
order_lookup_failed
reorder_started
return_reason
```

Define event ownership, payload version and deduplication. Do not emit raw phone, email, address, VIN, OTP, tokens or payment data. Redact sensitive search input. Exclude test/audit traffic.

Measure exact-number success, top-five relevance on a judged set, wrong-family/year rate, zero-result recovery, time to confident selection, quote completion, checkout step completion, paid conversion, wrong-fit returns, delivery accuracy, repeat purchase and workshop procurement time.

Do not claim conversion uplift without production measurement. Do not A/B test truthful versus misleading fitment or policy copy: fix correctness unconditionally.

### 16.2 Performance

Measure before and after on representative routes. Separate lab results from real-user data. Do not call script wall time an LCP measurement.

Target good field p75 Core Web Vitals: LCP ≤2.5 seconds, INP ≤200 milliseconds, CLS ≤0.1, segmented by mobile/desktop. Establish realistic search/filter budgets from baseline data; suggested initial objectives are visible suggestions within 500ms p95 after debounce and filter updates within 800ms p95 on the target connection.

Audit the default 75-card page and optional 150/200-card sizes. Reduce initial workload where measurements justify it. Use crawlable pagination or controlled Load more with state/scroll restoration; avoid unbounded infinite scroll.

Cap/deduplicate enrichment prewarming and prefetch requests. Core identity/fitment facts should be prepared in ingestion/indexing rather than expensively discovered on every card hover.

Reserve media dimensions, load the actual LCP asset appropriately, lazy-load lower content, and keep skeleton geometry stable. Do not show success/verified/payment states optimistically.

Cache keys include all relevant query, vehicle, facet, currency/destination and catalog-version dimensions. Never publicly cache private checkout/order data. Revalidate purchase-critical stock, price, quote and policy state server-side.

## 17. Implementation sequence

Use this dependency order. Work across phases until the implementable scope is complete; do not stop merely because Phase 1 passed.

### Phase A — baseline and contracts

Reproduce known failures. Map active routes and data sources. Record existing behavior worth preserving. Agree/code the shared contracts and migration strategy. Identify missing business-policy/provider inputs early.

### Phase B — correctness fixes

Fix I01–I05 first: search constraints, fitment truth, effective policies, identity and publishability. Also repair autocomplete contrast/error states and broken-image fallbacks. Build regression fixtures before expanding UI.

### Phase C — complete commerce experience

Implement canonical vehicles, filter/state behavior, card/PDP hierarchy, shipping/freight, mobile/homepage/navigation, guest checkout and persistent orders. Keep all consumers on the shared contracts.

### Phase D — intelligence and repeat procurement

Implement supported VIN/OE/assisted-discovery adapters, sync/reorder/alerts and workshop job ordering. Gate unavailable providers honestly. Integrate these into the same buyer/account experience.

### Phase E — end-to-end verification and documentation

Run relevant unit, integration, browser, accessibility, visual and performance checks. Verify both exemplar journeys below. Update docs/contracts/decision log. Produce a release checklist and explicit external dependencies.

## 18. Required end-to-end journeys

### 18.1 Novice retail buyer

Scenario: owns a 2020 Toyota Land Cruiser, needs a front brake-pad set and does not know the number.

The buyer can:

1. Find vehicle entry immediately on mobile.
2. Select canonical year/make/model without duplicate aliases.
3. Resolve relevant engine/market/brake qualifiers or clearly request help.
4. Search/select front brake pads without receiving calipers as ordinary matches.
5. Compare compatible candidates, set contents, origin, condition and delivered offers.
6. Understand whether fitment is confirmed and why.
7. Add the correct quantity with a vehicle assigned to the cart line.
8. See shipping/return terms before payment.
9. Complete guest checkout in controlled tests without forced account creation.
10. See accurate payment status and recover the order from a fresh authorized session.

If suitable stock/evidence does not exist, the correct outcome is a clear no-match/verification/source request. Do not manufacture products or weaken constraints to force a happy path.

### 18.2 Expert mechanic

The mechanic can:

1. Paste a known exact part number and see exact/replacement distinctions.
2. Compare actual quantity, seller, dispatch and delivered cost.
3. Buy without unnecessary vehicle-selection steps, with fitment status still truthful.
4. Paste a mixed multi-line procurement list and resolve ambiguous/unavailable lines.
5. Assign different vehicles to different job/cart lines.
6. Save/resume and reorder with current price/stock differences disclosed.
7. Retrieve invoice/order/shipment information on another authorized device.

## 19. QA and release gates

Use existing testing infrastructure. Add focused tests for changed behavior, especially business invariants and cross-layer regressions. Avoid tests that merely duplicate component implementation.

Minimum release matrix:

| Area | Required evidence |
|---|---|
| Search | Exact/prefix/typo/vehicle/position/category constraints and explicit relaxation tests |
| Autocomplete | Contrast, keyboard, cancellation, non-OK response and out-of-order response tests |
| Fitment | Exact qualifiers, missing evidence, negative evidence, universal limits and cross-surface consistency |
| Catalog | Hidden/internal exclusions across all public consumers and index/cache transitions |
| Identity | Correct MPN/OE/provenance/condition in UI, search and metadata |
| Policies | Same effective rules across PDP/cart/review/receipt; version snapshot preserved |
| Filters | Multi-select/counts/chips/refresh/Back/query edit/currency/taxonomy/mobile sheet |
| Media | Missing/failed image and stable gallery/card layout |
| Shipping | Missing destination, valid quote, expired quote, freight and mixed shipments |
| Checkout | Validation, drafts, OTP states, stock/price changes and provider failure recovery |
| Payments | Duplicate-safe attempts/orders, authoritative confirmation and webhook replay handling |
| Orders | Fresh-device authorized details, guest recovery, unauthorized access and shipment updates |
| Retention | Sync merge, reorder differences, alert consent/deduplication/unsubscribe |
| Workshop | Bulk ambiguity resolution, line-level vehicles, saved jobs and permissions |
| Mobile/accessibility | Representative viewport screenshots, focus, contrast, touch and keyboard visibility |
| Performance | Reproducible before/after lab method; field instrumentation where available |

Run applicable lint, type checks, tests and builds. Report exact commands and outcomes. Inspect failures rather than skipping them. Broaden testing when changes or failures warrant it; do not spend time repeatedly running identical passing checks without new evidence.

Do not conduct real financial transactions or customer communications as QA without explicit authorization. Do not mark untested payment/notification paths as passed.

## 20. Final deliverables and definition of done

Deliver:

1. Working implementation in the existing app/API/shared packages.
2. Necessary migrations, dry-run/data-validation tooling and compatibility handling.
3. Meaningful automated regression tests and manual/browser verification evidence.
4. Screenshots demonstrating the real responsive experience.
5. Updated architecture, search, buyer, checkout and shared-contract documentation as applicable.
6. A completed I01–I20 checklist with statuses: implemented and verified; implemented but awaiting external activation; or blocked with exact reason.
7. A concise release/rollback checklist covering migrations, index/cache propagation, flags and provider dependencies.
8. A final report stating what changed, how it was tested, what remains unverified and any remaining operational decisions.

The task is not complete if the homepage looks better while search still misidentifies parts, fitment still overclaims, returns still conflict, freight still dead-ends, orders still depend on one browser, or core buttons lead to mock/stub behavior.

The task is also not complete if unavailable services are represented as working. Clearly state external activation requirements and keep those claims disabled until they are real.

**Begin by inspecting the repository and reproducing the known failures. Then implement the shared contracts and critical correctness fixes, and continue through the complete checklist.**
