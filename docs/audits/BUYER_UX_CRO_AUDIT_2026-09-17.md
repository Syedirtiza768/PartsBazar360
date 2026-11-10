# PartsBazar360 buyer experience: UX, confidence and conversion audit

**Last reviewed:** 2026-09-17  
**Audit target:** [PartsBazar360 buyer marketplace](https://partsbazar360.com/buyer/)  
**Deliverable:** Current-state audit, proposed experience, implementation backlog and release gates. This is a design and product recommendation, not a record of implemented changes.

## 1. Executive Assessment

**PartsBazar360's largest obstacle is the gap between its promise of fitment confidence and the evidence buyers actually receive.** The storefront already has a recognizable automotive identity, autocomplete, a garage, multi-select filters, product galleries, guest checkout, shipping estimates, WhatsApp support and seller grouping. Replacing these wholesale would waste useful work. The priority is to make search, product identity, compatibility, delivery and return promises agree from discovery through ownership.

Three concrete examples explain the problem:

- Searching `2020 Toyota Land Cruiser front brake pads` returned one **2003–2007 front-right brake caliper**, without an obvious explanation that the request had not been satisfied.
- A Delphi aftermarket brake-pad page was headed **“Delphi Brake Pads – OEM LP1305”**, while the same purchase area correctly called LP1305 a brand part number. Its product image remained broken after an additional six-second wait.
- The cart advertised **30-day returns**; the public policy describes **14-day eligible returns**; the shared cart disclosure code says new parts are not returnable and limits used-part returns to damage/fault. These are materially different expectations.

The next product promise should be: **Find the correct part, understand why it fits, compare the delivered offer, and know what happens if something goes wrong.** A polished interface cannot compensate for incorrect interpretation or contradictory promises.

### Evidence and boundaries

Evidence labels throughout this report:

- **L — Live:** Observed in a fresh headless Chromium session on 17 September 2026. Desktop: 1440 × 1000; mobile viewport: 390 × 844. This is browser viewport testing, not a physical-device usability study.
- **C — Code:** Confirmed in this local checkout. Local source and production can differ; implementation risks are not automatically deployed defects.
- **H — Hypothesis:** Expected buyer/conversion effect requiring analytics or user testing.
- **R — Recommendation:** Proposed behavior, not an existing capability or business guarantee.

Live coverage: landing, autocomplete, five search cases, filter surfaces, vehicle make/model/generation selection, two PDPs, add-to-cart, a populated guest cart, checkout entry, support, and desktop/mobile screenshots. A disposable guest cart was used. No message, OTP, payment or order was submitted. Payment completion, SMS delivery, authenticated ownership, tracking, refunds and cross-device order access were not transaction-tested. Those sections use source review and explicit acceptance tests.

No production analytics, session recordings, search logs, payment-provider reports or representative customer interviews were available. Conversion impact below is **directional, not a measured uplift forecast**. Browser script durations include intentional waits and must not be reported as page-speed measurements. No Lighthouse/Core Web Vitals score is claimed.

### Preserve these foundations

Keep guest buying, seller shipment grouping, exact-number normalization/interchange labeling, URL-backed filters, staged filter previews, price-range validation, image zoom, recently viewed, device-local saves, recoverable checkout drafts, server-authoritative payment confirmation and payment idempotency. Improve their consistency and coverage.

## 2. Current Buyer Experience

| Stage | What exists / evidence | Friction or risk | Required change |
|---|---|---|---|
| Landing | Strong search-led hero and adjacent vehicle selector; explicit marketplace positioning. L | Two search fields, prominent external eBay escape route, technical language, no merchandise in the first desktop screen. Mobile selector starts below the first viewport. | One dominant search task plus a compact vehicle entry; concrete local value and purchase reassurance. |
| Search | Autocomplete with product/price previews; recent searches; exact and prefix results. L/C | Long vehicle query returns wrong category/year; typo produces zero results; homepage matching text is white on white. | Recognize intent; enforce critical constraints; correct descriptive typos; fix suggestion rendering. |
| Results | Price, title, identifier, seller, provenance and save control. L | Repeated badges, internal source abbreviations, missing/broken images, weak delivery/condition scanning. | Compact decision hierarchy and truthful availability/delivery. |
| Filters | Quick filters, all-filters sheet, staged multi-select, counts, URL helpers. L/C | Labels such as Inventory conceal source tags; model/year/engine and delivery refinements are not first-class filter groups. Technical implementation prose appears in the sheet. | Keep the controller; replace labels/taxonomy and add useful structured facets. |
| Vehicle | Make → model → generation → engine, save and shop actions. L | Duplicate makes/models, overlapping generation choices, no simple year-first novice route. | Canonical IDs, alias mapping and Year → Make → Model with optional detail. |
| PDP | Fitment prompt, gallery/zoom, copy number, seller offer, freight disclosure, specs and compatibility tables. L | Contradictory identity/policies, empty photo area, imported eBay instructions, generic related parts. | One verified product identity and one decision summary above long descriptions. |
| Fitment | Structured evidence model; device-local garage; per-line component. C | Unknown/check badges are suppressed; broad compatibility fallback can yield verified; mismatch state is not currently produced by evaluator. | Explicit evidence states and exact-configuration requirements. |
| Cart | Guest cart, quantity, seller grouping, destination estimate. L | Shipping excluded from apparent estimated total when destination absent; universal returns headline; no fitment badge without a vehicle. | Label subtotal honestly, resolve destination, display per-line uncertainty and policy. |
| Checkout | Guest Details → Review; card/Tamara; name, phone, address; email optional. L/C | Broad navigation/support competition; mobile country label truncated; technical settlement copy; OTP bypass path observed/inferred. | Focused checkout shell, country-aware fields, tested identity and failure flows. |
| Payment | Hosted provider attempts; source documents stable order identity and retries. C | Live provider completion/webhooks not verified in this audit. | Staging and approved payment QA before claiming end-to-end reliability. |
| Confirmation | Paid/pending/failed distinctions and authorized order polling. C | Actual notifications and receipt recovery untested. | Clear payment status, shipment promises and durable recovery links. |
| Post-purchase | Purchase list can load account orders; detail page reads browser-stored orders. C | A server-listed order may not open on another device; tracking detail is weak. | Authorized order-detail API, per-shipment events and guest recovery. |

### First 3–5 seconds

| Buyer question | Assessment of first screen | Specific improvement |
|---|---|---|
| What is this? | Automotive marketplace is apparent. | Keep the category identity; say “Car parts from UAE sellers” only for covered inventory. |
| Why buy here? | Fitment and seller assertions are present, but operational proof is thin. | Show verified compatibility coverage, location and delivery information at the point of selection. |
| Which kinds of parts? | New/used/OEM/aftermarket becomes clearer lower down. | One plain-language line: “Compare new aftermarket and genuine new or used parts.” Only include supported types. |
| Does it fit? | A selector is visible on desktop; vocabulary is specialist. | Replace “Set your fitment context” with “Find parts for your car.” |
| Can I trust you? | Legal identity is in the footer; reassurance is mainly assertion. | Link concise return terms and real support information near the primary task. |
| Why here rather than elsewhere? | A large eBay CTA suggests the external store may be the safer destination. | Move external-store access to secondary navigation; retain measurable attribution for buyers who prefer it. |
| What next? | Search or four-step selector; many disabled controls compete. | Search by number/name; secondary “Choose my vehicle”; expert buyers can skip vehicle entry. |

Suggested above-fold copy: **“Find the right part for your car.”** Supporting line: **“Search by part number, part name or vehicle. Compare condition, delivery and seller terms before you buy.”** Search placeholder: `Part number, brake pads, or Toyota Land Cruiser`. Adjacent action: `Choose my vehicle`. Add “Need help identifying a part?” as a quiet support route.

This is an expert heuristic, not an actual five-second comprehension study. Validate with unfamiliar buyers: after five seconds ask what the site sells, how to find a fit, and why they would trust it.

## 3. Top UX/Conversion Problems

### TOP PARTSBAZAR360 UX GAPS

P0 = critical correctness or purchase-promise issue; P1 = high-impact friction; P2 = material enhancement; P3 = later opportunity. P0 does not mean a measured outage.

| Gap / current problem | Why it matters | Buyer impact | Likely conversion impact | Recommended solution | Priority |
|---|---|---|---|---|---|
| G01: Specific vehicle/pad query returns an older caliper. L | Search appears to understand a request it has not satisfied. | Wrong shortlist; potentially wrong purchase. | Lost confidence or costly return. H | Separate hard part-type/vehicle constraints from relevance; disclose and consent to any broadening. | P0 |
| G02: Fitment verification can use broad YMM overlap; unknown badges disappear. C | A catalog row is not proof for an exact engine/trim/production variant. | False confidence or no actionable answer. | Abandonment and wrong-fit orders. H | Evidence-based state contract; unresolved constraints remain unresolved. | P0 |
| G03: 30-day cart claim, 14-day policy, restrictive modal. L/C | Return eligibility is central to perceived risk. | Cannot predict remedy. | Checkout hesitation and disputes. H | One versioned, offer-level effective policy rendered everywhere. | P0 |
| G04: Aftermarket MPN called OEM; missing provenance defaults toward genuine. L/C | Product identity and authenticity become ambiguous. | Pays for an expectation the item may not meet. | Trust damage and avoidable returns. H | Separate manufacturer number, OE references, provenance and condition; default to unspecified. | P0 |
| G05: Internal payment-verification item appears in homepage feed. L | Operational data reaches merchandising despite documented exclusion. | Site looks unfinished; accidental internal-item purchase possible. | Credibility loss. H | Central publishability filter across feeds, suggestions, related items, cache and index. | P0 |
| G06: Duplicate makes/models and overlapping generations. L | The vehicle selector amplifies source-data inconsistency. | Buyer cannot know which Toyota/Land Cruiser path is authoritative. | Vehicle-flow abandonment. H | Canonical vehicle graph with aliases and exact year choice. | P1 |
| G07: Broken/missing images on high-ranked pads. L | Buyers inspect shape, connectors, labels and condition. | Cannot identify what arrives. | Reduced PDP confidence. H | Validate exact images, durable rendering/fallback, photo-completeness merchandising rules. | P1 |
| G08: Imported eBay policy/contact instructions remain on PDP. L | Purchase/support responsibility becomes unclear. | Leaves marketplace or asks which terms apply. | Leakage and support burden. H | Extract structured seller facts; remove channel-specific instructions from rendered commerce copy. | P1 |
| G09: Freight item offers Buy now before quote resolution. L/C | Intent is collected for an order whose shipping cannot yet be finalized. | Late stop at review. | Avoidable checkout abandonment. H | Quote-led offer, saved quote cart, expiry and resume checkout. | P1 |
| G10: Query entry builds a fresh parameter set; live query change cleared the applied category. L/C | Changing a word can reset chosen refinement context. | Repeats filtering; worries filters are unreliable. | Search-loop fatigue. H | Explicit query-edit policy; retain vehicle and relevant constraints. | P1 |
| G11: Mobile card density, truncated identifiers and floating chat overlap. L | Small screens hide the facts needed for comparison. | Reopens PDPs and loses place. | Slower decisions. H | Mobile row option, fewer badges, protected interaction areas. | P1 |
| G12: Order details depend on browser storage. C | Ownership should survive a new device and refreshed shipment state. | Account list/detail inconsistency; difficult tracking. | Reduced repeat use and more support. H | Server-authorized order retrieval and guest recovery. | P1 |

## 4. Buyer Psychology Analysis

| Buyer | Job to accomplish | Questions / uncertainty | Abandonment trigger | Confidence and immediate purchase trigger |
|---|---|---|---|---|
| Exact OEM-number buyer | Obtain a known identity at an acceptable landed cost. | Exact match or interchange? Genuine? Available quantity? | Number changed silently; no dispatch/cost clarity. | Exact-match label, copyable number, stock, delivered cost and fast quantity selection. |
| Knows only the vehicle | Discover the right component. | Which engine/trim? What is the part called? | Must understand generation codes before browsing. | Simple year/make/model start, illustrated categories, guided clarification. |
| Searches make/model/year | Convert vehicle words into compatible choices. | Did search interpret my car correctly? | Old-year or wrong-model products mixed in. | Interpreted vehicle chip requiring confirmation, then matching products. |
| Knows the part name | Find a category and correct variant. | Front/rear? Left/right? Set or single? | Related but different components dominate. | Type and position extraction; “front axle set” quantity disclosure. |
| OEM versus aftermarket comparer | Choose value without sacrificing suitability. | Original branded part, OE supplier, or alternative? Warranty difference? | “OEM quality” used as an authenticity claim. | Side-by-side evidence, brand, condition, included quantity, warranty and landed cost. |
| Unsure about fitment | Transfer uncertainty to a reliable verification process. | Who confirms? What if their answer is wrong? | Generic green badge followed by a disclaimer. | Traceable vehicle-specific answer and a clearly defined remedy when eligible. |
| Frequent workshop buyer | Minimize job delay and procurement labor. | Can I buy a list? Which seller can dispatch all today? | Repeated vehicle forms; unclear pack sizes; fragmented shipments. | Bulk-number entry, saved job carts, availability timestamps, consolidated supplier choices. |
| Low-knowledge retail buyer | Fix a problem without making an expensive mistake. | What am I buying? Is installation included? | Abbreviations, supplier codes, unstructured technical walls. | Plain naming, photos, package contents, fitment help and honest installation expectations. |
| Returning reorder buyer | Repeat a successful purchase. | Same part/seller? Price or supersession changed? | Cannot retrieve old order on this phone. | Buy-again with price/stock/identity changes highlighted before confirmation. |
| Time-poor mobile buyer | Complete a known purchase quickly. | Can I do this one-handed? Will input be lost? | Keyboard hides CTA; OTP/form repeats; chat covers controls. | Saved context, autofill, resilient checkout and an unobstructed primary action. |

These are research hypotheses. Recruit retail buyers, mechanics and repeat customers separately; do not infer workshop priorities from retail conversion alone.

### Ethical conversion mechanisms

**Clarity:** state part type, position and quantity before persuasion. **Authority:** show the evidence source and accountable seller rather than a decorative shield. **Social proof:** display verified transactions/reviews with counts and recency; no invented ratings. **Reduced risk:** disclose exclusions before payment. **Information scent:** keep the searched number, selected vehicle and selected variant visible. **Commitment:** let a saved car or shortlist reduce future work without forcing signup. **Choice architecture:** compare a few genuinely compatible offers on meaningful tradeoffs. **Progressive disclosure:** reveal engine/production details only when they affect the part choice.

Use stock scarcity only from current salable inventory. Use dispatch cutoffs only from actual seller/carrier capability. No fake countdowns, preselected add-ons, hidden fees or generic “best seller” claims. A failed purchase should be prevented, not converted through reassurance unsupported by data.

## 5. Search & Discovery Audit

### Reproducible live search sample

| Input | Observed result | Interpretation |
|---|---|---|
| `51118069942` | Three BMW bumper listings, including shortened/formatted identifiers. | Useful exact/normalized discovery; relationship between variants still needs explanation. |
| `04465` | 82 parts; autocomplete previews and prices appeared. | Partial-number retrieval exists. Do not propose it as missing. |
| `brake pads` | 2,280 parts, 75 per page. | Strong recall, but broad presentation; a wear sensor also appeared in the captured page. |
| `brkae pads` | Zero; sourcing request and clear-search route offered. | Recovery exists, but it treats a spelling error like an unavailable part. |
| `2020 Toyota Land Cruiser front brake pads` | One 2003–2007 front-right caliper. | Critical intent/constraint failure, not proof the requested pads are out of stock. |

Counts are snapshots, not fixed inventory promises. Evidence: the corresponding `search-*.txt` files in the audit evidence directory; direct [vehicle query](https://partsbazar360.com/buyer/search/?q=2020%20Toyota%20Land%20Cruiser%20front%20brake%20pads) and [typo query](https://partsbazar360.com/buyer/search/?q=brkae%20pads).

The active search page calls `/search/parts`; autocomplete calls `/search/suggest`. The repository also has a richer `search-v1` implementation with interpreted-query/correction concepts. Therefore, **inventory existing search capabilities and route wiring before building another search stack**. Backend code containing a feature does not establish that the live buyer receives it.

### Proposed search contract

1. Normalize Unicode, punctuation, spacing and case without losing the raw input. Keep identifiers as strings: preserve leading zeros, meaningful suffixes and manufacturer scope.
2. Classify intent: identifier, descriptive part, vehicle, brand/category, or mixed query. A VIN-looking string is a candidate, not automatically a valid vehicle.
3. Extract explicit constraints: year, make/model, engine, axle/side, part family and number type. Show the interpretation in editable chips.
4. Retrieve exact identifiers first. Rank authorized supersessions and validated OE cross-references separately. Prefix matches must be labeled partial.
5. For descriptions, expand a curated domain dictionary: brake pad/pads, disc/rotor where appropriate, abbreviations and regional terminology. Never equate pads with calipers or front with rear.
6. Correct descriptive misspellings with a visible “Showing brake pads; search original” option. Do not silently fuzzy-correct exact part numbers.
7. Apply vehicle constraints using fitment evidence. If vehicle details are incomplete, ask the next discriminating question instead of showing a verified fit.
8. Use semantic retrieval to improve candidate recall only; exact identity and compatibility rules control what can be represented as a match.
9. When strict results are empty, explain the missing constraint and offer separate alternatives. Do not silently relax year, position or part family.

Proposed response fields: `queryId`, `rawQuery`, `interpretedQuery`, `constraints`, `corrections`, `matchType`, `matchedIdentifier`, `fitmentState`, `fitmentEvidenceId`, `total`, `facets`, `offers`, `relaxationsAvailable`. Make the same interpretation available to results, suggestions, analytics and support.

### Autocomplete interaction

On focus: selected vehicle, up to five recent searches with a clear option, and useful category shortcuts. Popular queries should come from real demand and must not leak another buyer's history. On typing `04465`: show “Part-number prefix 04465,” then up to five product previews with complete identifier, compact title, thumbnail/fallback and starting price. Display a fitment state only against a selected, sufficiently specified vehicle. Finish with “See all matching parts.”

For `Land Cruiser brake pads`: show vehicle clarification and front/rear choices before a wall of products. Keep the input editable; arrow keys, Escape and Enter must work across every suggestion, including the final search action and recent items.

Immediate code corrections: `HeroSearch.Highlight` uses white text for matched tokens on the white suggestion panel; use a high-contrast inherited/dark color. In `useSearchSuggestions`, ensure non-OK responses clear loading, abort in-flight requests when the query is cleared/shortened, and reject responses whose request key no longer matches. Align navigation count with the actual rendered options; the hook counts suggestion groups but consumers add other options. Verify these with keyboard and delayed-response cases.

### Advanced discovery, in order

| Capability | Role | Conditions before release |
|---|---|---|
| VIN/frame lookup | Reduce vehicle ambiguity. | Licensed data, market/production coverage, explicit confirmation of decoded vehicle; decoding alone is not part fitment. |
| Photo/OCR search | Read a label or identify a category for novices. | User confirms recognized number; image similarity never establishes compatibility. |
| AI assistant | Translate everyday requests into structured search and explain verified evidence. | Retrieval-grounded output; no invented stock, interchange, authenticity or fitment. |
| License-plate lookup | Optional convenience for supported markets. | Verify local legal basis, consent, provider rights and coverage before design commitment. No UAE availability is asserted here. |

Start with exact-number speed and trustworthy vehicle interpretation. A chat interface is not a prerequisite.

## 6. Filter Architecture

Live verification: selecting Brakes in the all-filters sheet produced a preview of 2,277 parts and applied `categoryGroup=Brakes` to the URL. Refresh retained it; changing the header query to `oil filter` removed it; browser Back restored the previous query/category URL. This establishes the tested state transitions, not that every facet combination or scroll position is correct. The filter controls use pressed buttons styled as checkboxes.

Retain the existing staged multi-select system and its count previews. Its OR-within/AND-across model, price validation and URL serialization are useful foundations. Replace technical copy such as “same staged selections as the quick filters and sidebar” with “Choose filters, then show results.”

### Buyer-facing groups

| Order | Group | Fields / behavior |
|---|---|---|
| 1 | Your vehicle | Saved configuration; year/make/model/engine when required; clear distinction between vehicle identity and a make-only browse filter. |
| 2 | Part | System → category → component; position/side; set/single quantity; category-specific dimensions. |
| 3 | Part origin | Genuine vehicle-brand part / aftermarket / unspecified. Explain OE-supplier status separately; do not conflate it with genuine packaging. |
| 4 | Condition | New / used / remanufactured; additional used grading only when supported. |
| 5 | Brand | Canonical manufacturer brands, searchable, multi-select, result counts. |
| 6 | Availability and delivery | In stock, dispatch window, deliver-by date, pickup if supported; requires destination. |
| 7 | Price | Explicit currency; range; distinguish item price from delivered price. |
| 8 | Seller and location | Seller, dispatch location; stock ownership and location must be supported by offer data. |
| 9 | Number matching | Exact identity, validated replacements/interchange; advanced option, not a prominent choice for novice category searches. |

Keep source tags such as GEN/BLK out of the default buying vocabulary. They are ingestion/inventory identifiers, not understandable delivery or authenticity evidence. Existing `partType` also needs a clear schema distinction: product category and provenance must not share ambiguous names.

### State and interaction rules

- The URL is authoritative for applied search state. Keep draft filter state separate until Apply. Browser Back/Forward must restore chips, counts, sort, page and scroll position.
- Multi-select is OR within a facet and AND across facets. Counts should use the same eligibility/query logic as results and respect offer-level price/stock constraints.
- A checked zero-count value remains visible and removable. Never hide the only way to clear a filter.
- New query: preserve the garage vehicle and destination; retain explicitly pinned refinements; clear incompatible category-specific constraints with an inline explanation. Reset pagination. Offer “Search all vehicles” explicitly.
- `Clear filters` preserves the query/vehicle/destination. `Reset search` clears query/refinements and explains what happens to the saved garage. Do not make both labels do the same thing.
- Changing a make resets dependent model/engine selections; it never silently substitutes a different car.
- Taxonomy pages retain their category/brand scope; give users an explicit “Search all parts” exit. Keep existing taxonomy URL behavior.
- Filter preview requests use cancellation/request-key checks. While a preview is pending, say “Updating count…” rather than presenting the old count as current.
- On mobile, use a full-height sheet with group rows, internal scrolling, a fixed `Show N parts` footer and visible Reset. Decide explicitly whether closing retains drafts; recommend retaining them for the session and showing “Not applied” when reopened.
- Desktop uses a small quick-filter strip for the active category and an all-filters sheet. A permanent large sidebar is optional; do not display every possible facet at once.
- Sort defaults to relevant results for queries. Offer price, delivered price when quotable, delivery and newest as explicit options. Paid placement, if introduced, remains labeled and cannot override fitment constraints.

Acceptance matrix: select two brands; combine category and price; remove one chip; zero-result filter; inverted price range; refresh URL; copy URL to a fresh context; Back from PDP; Back after Apply; edit query; switch vehicle; clear all; change currency; deep-link into taxonomy. Assert both result IDs and visible UI state, not only the URL.

## 7. Vehicle/Fitment Experience

The garage should remember what the buyer knows while making missing details explicit. Start with **Year → Make → Model**. Ask trim, engine, body, market or production date only when needed to distinguish relevant part variants. Provide “I don't know” with guided verification. Do not force a novice to choose between multiple imported generation rows.

Normalize Toyota/TOYOTA to one canonical make, and reconcile Land Cruiser/LandCruiser/series-specific models through aliases and hierarchy. The live picker included both broad year ranges and individual years, including duplicate 2021 choices. Preserve the true regional and chassis distinctions in the data; do not deduplicate distinct configurations merely because their display names are similar.

### Fitment states: one definition across every surface

| State | Minimum evidence | Buyer copy / action |
|---|---|---|
| No vehicle selected | None | “Check fit for your vehicle” → inline vehicle selector. |
| Confirmed compatible | Verified part-to-exact-configuration relationship and all relevant qualifiers resolved. | “Fits your [vehicle]” → View evidence and restrictions. |
| Additional detail needed | Candidate compatibility but missing engine, production split, brake system or other required qualifier. | “Confirm engine to check fit” → targeted next question. |
| Not yet verified | Insufficient or conflicting evidence. | “Fit not verified” → request verification with part/vehicle context already attached. |
| Incompatible | Explicit exclusion or proven conflicting configuration. | “Does not fit [vehicle]” → compatible alternatives. |
| Universal with constraints | Documented universal application plus relevant dimensions/connector limits. | “Universal—check dimensions” → requirements. |

Do not equate missing evidence with incompatibility. Do not show an arbitrary confidence percentage; show what has been checked and what remains unresolved. “Likely fit” should become a precise missing-detail statement where possible.

The local evaluator's compatibility-table fallback uses make/model/year overlap and can return verified for `mvlVerified` rows without checking engine/trim. Model-prefix matching also warrants correction. Refactor this into a shared server verdict so cards, PDPs, cart and checkout cannot disagree. A database confidence score is not a customer guarantee.

### Placement

| Surface | Required fitment treatment |
|---|---|
| Suggestions | Compact match state for active vehicle; ask missing qualifier before promising a match. |
| Result cards | One line under the title; unknown remains visible in neutral styling. |
| Results header | Active vehicle + completeness indicator + Change; matching-only mode explicitly shown. |
| PDP | Beside price/CTA: state, exact configuration, requirements and evidence link. Keep long compatible-vehicle table below. |
| Cart | Vehicle assignment per line, including “Buying for another vehicle”; mixed workshop carts must not all inherit one active car. |
| Checkout | Revalidate each line against its assigned vehicle; preserve a snapshot of the evidence/policy used at order time. |

Garage features: multiple vehicles, nickname, active vehicle, confirmed model year, engine/trim, optional VIN/frame, edit/remove, last confirmation and relevant recent orders. Anonymous storage is useful today; offer optional account sync after value is delivered. Switching vehicles preserves the query but re-evaluates compatibility and clearly labels any previously selected item that no longer matches.

Support verification should return a durable result linked to the exact part/offer and vehicle, with the verifier, date and applicable qualifications. A WhatsApp conversation alone is not a reusable fitment record.

## 8. Product Listing UX

Cards should answer **what, whether it fits, condition, cost and availability** in that order. Current product cards expose useful identifiers and seller names, but lack a compact delivered-offer decision and show repeated source/condition badges.

Recommended scan hierarchy:

1. Exact-product photo, with one save control. Distinguish catalog image from actual used-item photos.
2. Two-line descriptive title: `Front brake pad set — Delphi` rather than imported adjective ordering.
3. `Fits your [vehicle]` or actionable uncertainty.
4. `New · Aftermarket · Front axle set` as one line. Keep brand separate from provenance.
5. Manufacturer number, fully available via expansion/copy; optional OE match reason.
6. Price and pack basis; `From` only for a real multi-offer comparison.
7. In-stock/dispatch status and a destination-based delivery window or “Enter destination.”
8. Seller name and concise return eligibility; detailed terms on PDP.

Use `Choose offer` for multiple sellers and `View part` for uncertain/used/variant-heavy products. Allow quick add only when quantity basis, offer, price and required fitment details are resolved. A universal add-to-cart button on every card would speed up wrong purchases.

Provide a compact list view for mechanics: number, description, brand, origin, condition, stock, delivered price and quantity. Compare up to three equivalent-fit products; compare offers for the same canonical item separately from products with different brands or condition. Do not merge unique used parts just because they share an OE number.

Avoid clutter: one compatibility line, one condition/origin line, one price block. Hide ingestion tags. Category metadata should help disambiguate, not repeat the title. Missing images should use a deliberate fallback, never raw broken-image alt text. Do not generate speculative product imagery.

## 9. Product Detail Page Audit

The sampled BMW bumper PDP has a substantial gallery, zoom, copyable number, warehouse/stock display, a freight warning, compatibility table and specs. These are useful. The problems are **contradiction and decision order**: imported descriptions talk about eBay checkout/messages; a generic compatibility assurance coexists with a broad warning; duplicate condition badges consume attention; generic related parts include unrelated vehicles.

The sampled [Delphi LP1305 page](https://partsbazar360.com/buyer/parts/delphi-aftermarket-brake-pads-lp1305/) showed a broken large image and OEM/aftermarket identity conflict. Confirmed by live capture, not extrapolated to every PDP.

### Ideal top-to-bottom hierarchy

| Order | Module | Required information |
|---|---|---|
| 1 | Navigation context | Back to results retaining query/filter/scroll; breadcrumb; selected vehicle. |
| 2 | Identity + gallery | Plain title, brand/manufacturer number, condition/origin; actual-item or catalog photos; meaningful zoom and damage close-ups. |
| 3 | Fitment decision | Personalized state, unresolved qualifiers, evidence and verification action. |
| 4 | Purchase panel | Selected offer/seller, stock quantity, unit/set contents, price, destination, shipping/total or quote requirement, dispatch and delivery distinction. |
| 5 | Risk summary | Effective returns, return-shipping responsibility, warranty, item exclusions and who helps. |
| 6 | Purchase controls | Quantity; primary Add to cart; secondary express purchase only when offer is ready; pending/success/error state. |
| 7 | What arrives | Included pieces, side/axle, hardware/sensors included or excluded, packaging, used-condition defects. |
| 8 | Specifications | Category-specific structured attributes with units; connector/pin count, dimensions, position and relevant restrictions. |
| 9 | Compatibility and OE references | Filterable vehicle table; validated replacement/supersession relationships; explain different numbers. |
| 10 | Seller and service | Verified legal identity if checked, location, dispatch performance and reviews with denominators; support route. |
| 11 | Description / installation context | Sanitized product-specific description, diagrams when licensed, professional-installation guidance when relevant. |
| 12 | Alternatives and related components | Verified equivalent-fit alternatives first; compatible job complements second. No irrelevant cross-vehicle fillers. |
| 13 | Recently viewed / footer | Restore comparison context without repeating long marketing blocks. |

On desktop, keep the buy panel sticky only while it remains useful; on mobile show price and one primary action in a safe-area-aware bar after the main purchase panel scrolls out. Gallery height must not force a full screen of blank space when an image fails. Use tap/pinch zoom with close/back support; thumbnails should indicate actual image count without duplicated source variants.

For used parts require damage/condition descriptions, actual images, what is included, tested/not tested with scope, and donor details where useful. “100% tested” without a defined test is seller copy, not platform certification. For brake pads, explicitly state axle set versus individual piece and whether hardware or sensors are included. “Frequently bought together” must match the selected vehicle and package contents; no automatic cart additions.

## 10. Trust & Buyer Confidence

| Anxiety | Relevant proof | Implementation |
|---|---|---|
| Wrong fit | Exact application evidence and accountable verification. | Show evidence beside the CTA; preserve order snapshot; publish a remedy only for eligible verified cases. |
| Counterfeit / wrong origin | Genuine-brand provenance or truthful aftermarket classification. | Separate seller assertion from platform-checked documentation; unknown stays unknown. |
| Poor used condition | Actual-item photos and inspection scope. | Photo checklist and defect disclosure; distinguish cosmetic and functional status. |
| Seller disappears | Verified business identity and marketplace case ownership. | Seller profile, support case ID, response expectations and escalation path. |
| Delayed repair | Real stock location and dispatch/delivery estimate. | Offer-level inventory timestamp and quote; avoid “local” unless stock is actually local. |
| Expensive return | Item-specific eligibility and responsibility. | One effective policy at PDP/cart/review/receipt; plain exclusions before payment. |
| Payment uncertainty | Clear amount/provider and recoverable status. | Hosted payment, explicit pending state, duplicate-safe retries and order lookup. |

Resolve the return-policy conflict before testing new promotional copy. Product/operations must choose the applicable rules; engineering must not arbitrarily pick 14 or 30 days. Store `policyId`, version, eligible conditions, window, exceptions, responsibility and warranty separately. Bind the rendered summary to the chosen seller offer and persist the accepted version in the order.

Preserve UAE credibility already present in the footer: the operating company and trade-license number. Move a concise link to “Who we are” nearer purchase decisions. Add phone/WhatsApp availability and actual support hours if operationally supported. The live support page promises a first reply within one business day; do not relabel that as instant fitment approval.

A seller badge should explain what was verified. Product reviews and seller service reviews should be distinct. For a new seller, show “New seller” and the protection process rather than empty stars or fabricated transaction history. Refund/fitment guarantees require a funded operational policy, not only a badge component.

## 11. Cart & Checkout

**Keep the current progressive guest architecture: Details → Review → hosted payment.** A drawer checkout would make multi-seller shipping, freight and fitment resolution harder. A large single form would increase mobile scanning. Express checkout can be layered on for returning buyers with complete offer/address context.

### Cart

Group by seller and shipment; within each line show image, identity, quantity basis, condition, assigned vehicle/fitment state, current availability and effective return eligibility. Let buyers save an item for later or remove it with Undo. Quantity updates show pending state; never imply a quantity is reserved until the server confirms.

Ask for country and, where needed, emirate/city early. With no quote, label the amount **“Items subtotal—shipping not yet included”**, not a complete-looking estimated total. Once available, show items, shipping per shipment, tax treatment and payable total. Display foreign-currency conversion/charge amount clearly; remove “merchant settlement” language from the buying interface.

Freight items need `Request delivery quote` as the primary offer action. Save item, quantity and destination in a quote request; return an expiring shipping amount and resume link. In mixed carts, offer to purchase courier-ready items separately or wait for the freight quote. Do not allow an apparently normal Buy now flow to culminate in an unexplained disabled Pay button.

### Field-by-field treatment

| Field/control | Current/source | Recommendation |
|---|---|---|
| Phone | Required; country code; live page uses bypass-style copy. | Explain order-update purpose; normalize/validate; clear country selector; OTP only with tested identity requirements. |
| Full name | Required. | Keep one field; support autofill. |
| Email | Optional. | Keep optional for receipts; do not make it required merely for marketing. |
| Address line 1 | Required. | Country-aware label; building/street help for local addresses. |
| Address line 2 | Optional. | Collapse as “Apartment, unit or landmark.” |
| City | Required. | Suggest appropriate city/locality without preventing manual entry. |
| State/emirate/province | Optional in validation. | Show only relevant country-specific field; avoid city/emirate duplication. |
| Postal code | Optional in validation. | Require only for destinations/carriers that need it; do not force invented UAE postal data. |
| Country | Required. | Carry cart destination forward; changing it visibly refreshes shipping. |
| Payment | Card and Tamara observed. | Show only eligible methods; explain redirect and final charge amount. Provider eligibility and wallet availability require testing. |
| Coupon | Review-step field. | Collapse behind “Have a code?”; retain valid code on retries; show server-confirmed savings. |
| Fitment confirmation | Review-step acknowledgement in source. | Replace blanket risk transfer with per-line resolution; an unchecked box cannot compensate for incorrect verification. |

The source supports OTP autofill/paste/auto-submit, resend cooldowns and recoverable drafts. These are not missing features. The live checkout displayed phone input alongside delivery fields without requiring an OTP during the inspected entry flow; this is consistent with the documented bypass, but runtime configuration was not independently read. Restore/validate the intended identity boundary through an operational review; do not advertise verified contact identity for unverified numbers.

Error behavior: show field-specific messages and a focusable summary; retain all safe input after shipping failure, timeout, decline or cancelled redirect. Distinguish payment declined, still pending and unknown status. On an uncertain provider outcome, fetch order state before creating another attempt. Display Pay once, prevent duplicate submission, and use server idempotency—not only a disabled button.

### Confirmation and post-payment acceptance

Only confirmed payment produces “Order confirmed.” Pending state says payment is being checked and warns against paying again. Show order number, receipt access, purchased identities/condition, per-seller delivery windows, shipment count and support. Account creation is optional afterward.

Required tests before signing off this flow: successful/declined/cancelled payment, lost redirect, delayed/duplicate webhook, refreshed review, expired checkout token, OTP wrong/expired/resend, shipping-country change, price/stock change, unavailable freight quote and partial shipment. Run against controlled fixtures/staging, then an explicitly approved production payment test. No successful charge or refund was executed for this audit.

## 12. Mobile Experience

Live 390-pixel observations: the header search is visible, but a long hero repeats it; the vehicle form starts below the first screen; placeholder text clips; two-column product cards stack badges and truncate identifiers; the WhatsApp bubble overlays the right product card and checkout form area; the country-code selector abbreviates its selected label. Captured home/results/PDP pages had no document-level horizontal overflow, which is worth preserving.

Specific changes:

- Compress the mobile hero to headline, one search field, `Choose vehicle`, and a short confidence line. Move the long buying-loop explanation lower or remove repeated claims.
- Keep search visible as a compact sticky control after scrolling. Open suggestions in a full-width panel that respects the software keyboard; back closes search before leaving the page.
- Use a compact product list option with number/condition/fitment/price visible together. Maintain two columns only where the facts remain legible.
- Anchor Filters and Sort below the results title without truncating the result count. Full-screen filter sheet has one sticky apply footer, close/back and focus restoration.
- Vehicle entry uses one decision per step with editable summary and a meaningful Back action. Allow an incomplete vehicle to be saved as incomplete.
- Show thumbnail gallery with swipe and explicit image count; no reliance on hover zoom. Fitment appears before the buying action.
- Use one bottom purchase CTA; move support into the purchase/help surface or a collision-aware slot. Avoid stacking bottom navigation, chat and purchase bars.
- Browsing bottom navigation: **Home, Search, Garage, Saved, Account**; cart stays in the header. On PDP replace the bottom nav with purchase controls; on checkout use the focused checkout footer.
- Use approximately 44–48 CSS-pixel product touch targets as a design goal; do not describe that as the WCAG 2.2 AA minimum. WCAG's minimum target-size rule is 24 CSS pixels with defined spacing/exceptions. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Check 320/360/390/430 widths, 200% zoom, long vehicle names, RTL Arabic layout if offered, slow network, keyboard-visible address/OTP and safe-area insets. Native keyboard/autofill behavior still needs physical iOS/Android testing.

## 13. Retention & Repeat Purchase

Retention should preserve successful work: the right vehicle, the right part, the right seller and the completed job.

| Capability | Value | Priority / prerequisite |
|---|---|---|
| Durable orders and shipment tracking | Find receipts and progress from any device. | P1; authorized server details and guest recovery. |
| Synced garage | Avoid vehicle re-entry across devices. | P2; anonymous-to-account merge, per-vehicle privacy. |
| Buy again | Repeat a successful identity quickly. | P2; recheck supersession, current stock/price and vehicle assignment. |
| Saved parts / recently viewed | Resume a comparison. | Existing baseline; improve identity/fitment context and optional sync. |
| Saved search / back-in-stock | Recover genuine unmet demand. | P2; explicit opt-in, reliable availability and easy unsubscribe. |
| Price-drop alerts | Act on an identified purchase intent. | P2; same offer/condition/quantity comparison, meaningful thresholds. |
| Vehicle-specific service collections | Reduce research for common jobs. | P2; evidence-backed compatibility and package contents. |
| Workshop job carts and bulk numbers | Reduce procurement time across customer cars. | P2; per-line vehicle, quantities, stock and role-based business account. |
| Purchase orders, invoices, approvals | Support recurring B2B workflow. | P2; business needs research, accounting and authorization. |
| Loyalty | Reward repeat value. | P3; validate unit economics and actual repeat behavior first. |

Do not send inferred maintenance alerts based only on an old order. Ask for mileage/service preferences and let buyers control reminders. Do not mix a workshop's customer vehicle histories with an unrelated employee's personal garage.

The local purchase-list page can fetch authenticated orders, while the detail route reads local stored orders only. Fix that inconsistency before promising cross-device order management. Server authorization must check ownership; knowing an order ID must never grant access.

## 14. Competitive Benchmark

This is a comparison of verified public patterns, not a completed purchase test on every competitor. Competitor claims describe their own offerings and do not prove their real-world service quality. Geography, eligible items and terms differ.

| Platform / source | What it does well | Why it works | Learn | Improve upon the pattern |
|---|---|---|---|---|
| [eBay Motors](https://www.ebay.com/help/buying/buy-now/buying-ebay-motors?id=4639), [Guaranteed Fit](https://pages.ebay.com/motors/ebay-guaranteed-fit/) | Saved-vehicle compatibility and a defined remedy for eligible items. | Connects fitment selection to reduced purchase risk. | Bind protection to exact eligibility and selected vehicle. | Explain evidence and unresolved qualifiers more clearly; combine this with UAE offer/delivery clarity. |
| [Amazon automotive fitment documentation](https://m.media-amazon.com/images/G/01/Automotive/Providing_ACES_Data_to_Amazon_Automotive.pdf) | Structured automotive fitment feeds and vehicle-filtering concept. | Reusable vehicle context depends on catalog relationships. | Invest in structured data behind the garage. | Expose the match basis and distinguish variants. Amazon's live buyer page was not accessible; no current checkout superiority is asserted. |
| [RockAuto choosing-parts help](https://www2.rockauto.com/help/?page=2) | Quality tiers and tools for minimizing shipping across choices. | Makes technical/value tradeoffs scannable. | Group truly comparable products and expose shipment economics. | Add clearer novice explanations and mobile comparison without losing expert density. |
| [AutoZone shopping/delivery](https://www.autozone.com/lp/online-shopping-fast-delivery) | Pickup and delivery options tied to eligibility. | Repair buyers can plan around availability. | Put fulfillment into discovery, not only checkout. | Offer truthful seller/location-level delivery across a UAE marketplace. Do not copy US promises. |
| [Advance Auto Parts pickup](https://shop.advanceautoparts.com/o/instorepickup), [delivery](https://shop.advanceautoparts.com/o/shippinginfo) | Location-dependent pickup/delivery choices. | Makes the next physical step concrete. | Destination/store context should alter available offers. | Compare sellers by “available for this job by this date,” when inventory supports it. |
| [CarParts.com fitment](https://www.carparts.com/help-center/guaranteed-to-fit) | Vehicle/VIN selection linked to fitment messaging. | A clear route from car identity to product choice. | Make vehicle selection easy and persistent. | Display unresolved production/engine constraints instead of overgeneralized assurance. |
| [PartsGeek](https://www.partsgeek.com/) | Obvious year/make/model entry and prominent review cues. | Lowers the novice's starting effort. | Familiar vehicle language and credible, inspectable proof. | Reduce promotional noise; show seller/item-specific confidence rather than generic reassurance. |
| [AUTODOC](https://www.autodoc.co.uk/), [return-service terms](https://www.autodoc.co.uk/services/shipping) | Registration-based discovery and explicitly described extended-return service. | Vehicle convenience and risk terms are visible product features. | Make both matching and return scope understandable. | Keep core protections clear; avoid preselected paid protection or unexplained market coverage. |
| [PartSouq](https://partsouq.com/) | Part number or VIN/frame as a central entry, genuine catalog links. | Strong information scent for Japanese/GCC specialist buyers. | Prioritize number and chassis-based catalog discovery. | Add evidence-backed aftermarket/used alternatives and transparent local delivered offers. |
| [Amayama](https://www.amayama.com/en) | Explains supplier sourcing → warehouse receipt → dispatch; offers help finding parts. | Sets expectations for non-immediate fulfillment. | Separate supplier availability from dispatch-ready stock. | Make local-stock versus sourced-to-order status directly comparable. |
| [SPARE247](https://spare247.com/) | Prominent part-code/VIN discovery and relevant regional catalog context. | Supports the way local specialists identify parts. | Treat number/VIN input as a primary task. | Combine expert speed with guided novice search, exact-fit evidence and accountable returns. |

PartsBazar360 should not compete on catalog-count claims alone. The strongest opportunity is the combination of **accurate identity, explainable compatibility, local offer availability and responsibility after the sale**. Each competitor demonstrates a piece; combining them coherently is the opportunity, not evidence that no competitor already does so.

## 15. Proposed Visual Design Direction

Keep the current automotive editorial character: charcoal, warm neutral surfaces, teal and a restrained orange action accent. The condensed display face can identify the brand. It should not carry every label, product title and instruction in uppercase.

Use a readable sans-serif for product titles/body, tabular numerals for price, and a legible identifier style for part numbers. Proposed baseline: 16px form/body text, 14–16px product titles, 12–13px secondary metadata; do not make critical fitment/return conditions tiny. Use a 4/8px spacing rhythm with tighter internal grouping and clearer gaps between decisions. Favor dividers over nested bordered cards; one subtle shadow for overlays, not every surface. Reserve semantic green/amber/red for evidence states rather than decoration.

Make imagery functional: consistent backgrounds for new catalog parts; authentic, well-lit multi-angle photos for used parts. Preserve scratches/defects. Avoid speculative AI-generated merchandise images. Use diagrams only when they identify relevant positions/components and rights are available.

Current visual issues: overly tall mobile hero; repeated reassurance blocks; product photos consuming large empty areas when unavailable; inconsistent rounded purchase panels versus rigid listing frames; repeated badges; source codes; small spaced uppercase CTAs; prominent eBay button competing with marketplace buying. Address hierarchy and content first, then consolidate components.

Normal text should meet 4.5:1 contrast and qualifying large text 3:1. Validate actual tokens instead of assuming teal on white passes. The homepage autocomplete's white matching token is a concrete contrast defect. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### Micro-interactions and perceived speed

| Moment | Feedback | Failure / motion rule |
|---|---|---|
| Search typing | Immediate input; compact loading indicator after debounce; stable suggestions panel. | Cancel stale responses; preserve input and offer retry on service failure. |
| Filter selection | Selected control updates immediately; count shows updating; apply maintains context. | No full-page flash; old results remain with a clear pending indication. |
| Vehicle check | “Checking compatibility…” then explicit evidence state. | Never show green optimistically; preserve unknown on failure. |
| Add to cart | Button pending → server-confirmed “Added”; cart count and small summary. | Inline error/retry; no success before API confirmation. |
| Save | Immediate bookmark state with Undo. | Roll back server-sync failure; device-local saves can acknowledge local success. |
| Quantity | Pending line total and final server-confirmed update. | Restore previous quantity if unavailable; announce actual stock constraint. |
| Gallery | Predictable swipe/zoom, thumbnail focus and image count. | No automatic carousel; usable fallback on media error. |
| Copy number | Short “Copied” confirmation. | Preserve selectable text if clipboard fails. |

Use 120–180ms transitions as a proposed design range, respect reduced motion, and avoid animation that shifts a target under the pointer. Announce changed totals/results with restrained live regions. Preserve focus after closing drawers.

### Performance plan

The current search page defaults to 75 products and offers 150/200; product cards also prewarm enrichment on intersection/hover. This is a workload risk to measure, not proof of poor Core Web Vitals. Cap concurrency and deduplicate enrichment requests; indexing/ingestion should prepare core purchase facts before the buyer arrives.

Use an initial 24–36-card experiment with crawlable pagination and optional Load more; restore scroll on Back. Avoid unbounded infinite scroll that hides the footer and makes comparisons hard. Eager-load the true hero/LCP image; lazy-load lower cards and gallery frames; reserve dimensions; cache validated thumbnails. Warm the next likely page or hovered PDP on good connections without flooding mobile networks.

Cache keys must include normalized query, vehicle, facets, sort, currency/destination when relevant, and catalog version. Never cache private order/checkout responses in public caches. Revalidate stock, charge amount, shipping and fitment before purchase, regardless of cached browse state.

Measure field p75 by device/network and route. Target **LCP ≤2.5s, INP ≤200ms, CLS ≤0.1**. These are standard good thresholds, not measured results for this site. [Web Vitals guidance](https://web.dev/articles/vitals). Proposed additional service budgets: suggestions visible within 500ms p95 after debounce on the target connection; filter updates within 800ms p95; immediate UI acknowledgement within 100ms. Establish baselines before committing SLAs.

## 16. Ideal Buyer Journey

### Retail: 2020 Toyota Land Cruiser, front brake-pad set, no OEM number

| Step | On screen | Buyer decision / system behavior |
|---|---|---|
| 1. Arrive | One search box, Choose vehicle, concise value/support. | Chooses vehicle route. |
| 2. Identify | Year 2020 → Toyota → Land Cruiser, with canonical names. | Confirms car; system asks engine/market/brake variant only if required. |
| 3. Resolve ambiguity | “We need one more detail to check brake-pad fit.” Engine choices or help locating VIN. | Supplies known detail or requests verification; incomplete selection never becomes confirmed. |
| 4. Find category | Vehicle chip + Brake system → Brake pads → Front. | Selects front pads or types the phrase; interpreted chips are visible. |
| 5. Compare | Only confirmed matches in primary results; unresolved candidates separated. Cards disclose axle-set quantity, brand, condition, delivery and price. | Compares a few compatible alternatives. No specific live stock/price is promised by this proposed journey. |
| 6. Open PDP | Exact part, images, evidence, set contents, seller, delivered offer and returns. | Checks whether clips/sensors are included; selects an offer. |
| 7. Verify if needed | Part + car already attached to verification request; precise missing question. | Gets a traceable answer or stops before a speculative purchase. |
| 8. Add | One front axle set added; assigned Land Cruiser shown; optional compatible extras unchecked. | Confirms quantity, avoids confusing one set with one pad. |
| 9. Cart | Destination, seller shipment, delivery range, full cost, effective return terms. | Accepts cost/time or changes offer. |
| 10. Details | Guest name/phone/address; optional email; tested verification when required. | Uses autofill and chooses eligible payment. |
| 11. Review | Exact part/vehicle, package contents, charge amount/currency, delivery and policies. | Pays once; UI preserves state through redirect. |
| 12. Confirmation | Confirmed or pending payment accurately labeled; order/receipt, seller shipment and support. | Saves receipt; optional account sync; no required signup. |

If the correct part is unavailable, show that truthfully with a saved search/source request. The “ideal” flow must not manufacture availability or skip variant checks to look frictionless.

### Mechanic: exact OEM number

1. Paste the number into global search; exact identity and validated alternatives appear immediately.
2. Choose the exact part or an explicitly identified replacement. Vehicle selection remains optional, with “Not checked against a vehicle” disclosed.
3. Compare stock quantity, unit/pack basis, delivered price and dispatch across sellers.
4. Set quantity or paste a multi-line job list; assign vehicles per line where useful.
5. Use saved business delivery details and purchase-order reference; review changed price/stock.
6. Pay or use an approved business payment workflow; receive invoice and shipment-level tracking.

This path optimizes expert speed without forcing the novice garage flow onto every buyer.

## 17. Proposed Screen Architecture

Each row is ordered from top to bottom. Shared principles: preserve vehicle/query context, expose uncertainty, and render product/offer/policy facts from canonical data.

| Screen | Information hierarchy |
|---|---|
| Buyer Homepage | Compact header/global search → clear value + vehicle entry → saved vehicle/resume if present → common categories → destination-aware, publishable parts for that vehicle → recently viewed/saved → genuine/aftermarket education and real service proof → curated brands → support/footer. |
| Search Experience | Input + active vehicle → interpreted query/corrections → recent or predictive suggestions → exact/partial/replacement match labels → See all → help only when interpretation fails. |
| Search Results | Back/breadcrumb → query and vehicle → one result count → active chips → relevant quick filters + sort → decision-focused cards/list → pagination/load more → recovery options. |
| Filters | Title/close → selected summary → vehicle/part/condition/origin/brand → availability/delivery → price → seller/location → advanced identifier matching → sticky Reset + Show N. |
| Product Detail | Back-to-results/vehicle → identity/gallery + fitment/purchase panel → what arrives → specifications → compatibility/OE references → seller/policies/reviews → exact-fit alternatives → useful job complements. |
| Garage | Active vehicle + Change → saved vehicles → Add vehicle → guided identity/detail → verification status → vehicle-specific purchases/saved parts → optional account sync. |
| Cart | Item count → destination → seller shipment groups with per-line vehicle → unresolved issues → cost breakdown → effective returns → Checkout → continue/save actions. |
| Checkout | Focused logo/help/back → Details/Review progress → phone/contact → country-aware address → delivery/eligible payment → review shipment/items/fitment → final amount/policies → Pay. |
| Orders | Lookup/sign-in appropriate to guest/account → recent orders/status → shipment timelines → item/vehicle snapshots → receipt/invoice → returns/support → Buy again. |
| Buyer Account | Orders first → Garage → Saved parts/searches → addresses → contact/security → business tools when applicable → notification preferences. |
| Mobile Navigation | Header logo/cart → persistent compact search and vehicle summary; browsing bottom Home/Search/Garage/Saved/Account; replace bottom navigation with purchase action on PDP/cart and focused progress on checkout. |

### Homepage section purpose

| Section | Buyer question | Conversion benefit |
|---|---|---|
| Search + vehicle entry | “How do I find my part?” | Fast entry for both expert and novice. |
| Resume saved vehicle/job | “Can I continue where I stopped?” | Reduces repeated work. |
| Common categories | “What is this part called?” | Recognition-based discovery. |
| Relevant available inventory | “Can I buy something useful here?” | Demonstrates real selection rather than random newest records. |
| Recently viewed/saved | “Which one was I comparing?” | Restores decision context. |
| Evidence and service proof | “Will you help if it is wrong?” | Explains accountability near intent. |
| Curated brands | “Do you carry a manufacturer I trust?” | Brand discovery without polluted raw facets. |
| Support/footer | “Who operates this and how do I contact them?” | Verifiable business identity and recovery. |

Desktop navigation: logo, dominant search, vehicle, saved, account and cart; a secondary category entry with a small number of understandable systems. Put Brands and Recently Viewed inside discovery/account surfaces, not a giant permanent menu. Orders should be directly accessible; Messages can live under order/support context. Support stays available with the current product/vehicle attached.

## 18. Top 20 Improvements Ranked by Priority

Impact labels are qualitative hypotheses. Complexity: S = localized change with focused QA; M = coordinated UI/API/data work; L = cross-system capability or substantial catalog/operations work. They are scope estimates, not delivery dates. FE = frontend; BE = backend; Data = catalog/search operations; PM/Ops = product and marketplace operations.

| Rank / ID | Improvement | Priority | User impact | Conversion impact | Complexity / owner | Dependencies / acceptance |
|---|---|---|---|---|---|---|
| 1 / I01 | Enforce part-family, position and explicit vehicle search constraints. | P0 | Very high | High | L; Search/Data/BE | Curated relevance set; Land Cruiser pads query never silently returns old caliper as match. |
| 2 / I02 | Replace overstated/suppressed fitment states with shared evidence verdict. | P0 | Very high | High | L; BE/FE/Data | Exact qualifiers; unknown shown; YMM-only evidence cannot yield exact-config assurance. |
| 3 / I03 | Resolve policy conflict and implement effective offer policy. | P0 | Very high | High | M; PM/Ops/BE/FE | Approved policy rules; same window/eligibility on PDP, cart, checkout and receipt. |
| 4 / I04 | Correct OEM/MPN/origin identity and unsafe genuine defaults. | P0 | High | High | M; Data/BE/FE | Typed identifiers/provenance; LP1305 correctly labeled; unknown never defaults to genuine. |
| 5 / I05 | Exclude internal/test/unpublishable items everywhere. | P0 | High | Medium | M; BE/Data | Common eligibility rule + index/cache invalidation; payment fixture absent from public feeds. |
| 6 / I06 | Canonicalize make/model/year choices and simplify selector. | P1 | Very high | High | L; Data/FE/BE | Alias/identity migration; single Toyota route, distinct true variants preserved. |
| 7 / I07 | Repair images and establish media-quality gate. | P1 | High | High | M; Data/FE | Exact media verification; no broken hero; informative fallback; no speculative replacements. |
| 8 / I08 | Strip imported marketplace instructions and normalize descriptions. | P1 | High | Medium | M; Data/FE | Preserve item facts; no eBay checkout instructions in local offer terms. |
| 9 / I09 | Add descriptive typo/synonym recovery and fix autocomplete defects. | P1 | High | High | M; Search/FE | Domain dictionary; `brkae pads` recovery; readable tokens; stale requests rejected. |
| 10 / I10 | Preserve filter/query/vehicle context predictably. | P1 | High | High | M; FE/BE | URL contract; Apply/Back/refresh/new-query acceptance matrix. |
| 11 / I11 | Show landed costs and make freight quote-led. | P1 | Very high | High | L; BE/FE/Ops | Valid destination quote, stock and carrier data; no hidden freight dead end. |
| 12 / I12 | Reorder PDP/card content around the purchase decision. | P1 | High | High | M; Design/FE/Data | Package contents, identity and fitment contracts; compact mobile scanning. |
| 13 / I13 | Simplify mobile hero/navigation and prevent overlay collisions. | P1 | High | Medium | M; Design/FE | 320–430 widths, keyboard/safe-area tests; chat never obscures inputs/actions. |
| 14 / I14 | Harden guest checkout, identity and recovery QA. | P1 | Very high | High | M; BE/FE/Ops | Tested OTP/provider behavior; drafts retained; no duplicate payment/order. |
| 15 / I15 | Fix server-backed order detail, tracking and guest retrieval. | P1 | High | Medium now; high retention | M; BE/FE | Authorized lookup; account list order opens on fresh device; status stays current. |
| 16 / I16 | Instrument discovery/funnel quality and performance. | P1 | Indirect high | Enables prioritization | M; Analytics/BE/FE | Event schema, privacy filtering, clean baselines and excluded audit traffic. |
| 17 / I17 | Curate homepage, brands and vehicle-aware alternatives. | P2 | High | Medium | M; Design/Data/FE | Clean brands/publishability; no unrelated cross-vehicle “alternatives.” |
| 18 / I18 | Add VIN/OE intelligence and grounded assistance. | P2 | High for covered catalog | Medium–high | L; Data/BE/Ops | Licensed coverage, exact evidence, review workflow; AI cannot invent compatibility. |
| 19 / I19 | Sync garage/saves, add reorder and opt-in alerts. | P2 | High for repeat buyers | Medium | L; BE/FE | Identity sync, stock events, order durability, consent preferences. |
| 20 / I20 | Add workshop bulk ordering and job procurement tools. | P2; loyalty later P3 | Very high for workshops | Segment-dependent high | L; PM/BE/FE/Ops | B2B discovery, line-level vehicles, pricing/permissions, invoicing. |

## 19. Phase 1 → Phase 4 Implementation Roadmap

Sequence by dependency and correctness, not a promised calendar. Parallel implementation is possible after contracts are agreed, but advancing phases does not justify leaving P0 misrepresentation unresolved.

### Phase 1 — Fix Conversion Killers

Scope: I01–I05 correctness fixes; I07–I11 targeted remediation; I13 mobile collisions; I14 checkout QA; I15 order-detail gap; I16 baseline instrumentation. For L-size items, ship a narrow correctness safeguard first, then expand in Phase 2. Examples: remove false verified states now; build the comprehensive evidence service next. Strictly reject misleading search broadening now; improve ranking later.

Deliverables: reproducible failing fixtures, publishability rule, reconciled return policy, corrected product labels, visible uncertainty, image fallbacks, readable suggestions, preserved search state, honest shipping totals and working recovery paths.

Release gate: all critical examples pass; no internal fixture in public merchandising; no contradictory return text; no exact-fit badge based only on broad YMM; payment retry/idempotency passes controlled tests; cart/checkout remains usable at 320px and with keyboard visible. For the checkout bypass, document operational state and validate its identity implications before changing it.

### Phase 2 — World-Class Commerce UX

Scope: complete I01/I02/I06/I10/I11/I12/I13/I17; formalize seller proof and verification case workflow. Reuse the existing filter controller and guest checkout foundation.

Deliverables: canonical vehicle picker, structured card/PDP, exact-fit offer comparison, destination-aware delivery, quote-led freight, adaptive category facets and coherent navigation. Clean catalog data is a dependency of the redesigned UI, not a cleanup deferred until after launch.

Release gate: retail and mechanic usability participants can independently find a candidate, explain whether fitment is confirmed, identify package contents, state delivered cost and describe return eligibility. Correct interpretation matters more than raw task speed. Ship by category/vehicle coverage so unsupported catalog areas remain explicitly unverified.

### Phase 3 — Intelligent Marketplace

Scope: I18 plus evidence-driven recommendations and supported portion of I17. Add VIN/frame/OE services before conversational assistance; semantic search improves candidate retrieval under hard compatibility rules.

Deliverables: licensed vehicle identification, validated cross-reference/supersession graph, searchable evidence, OCR candidate flow, grounded assistant and relevant job complements.

Release gate: a curated holdout set has no false confirmed-fit outputs; ambiguous queries ask for clarification; every generated factual recommendation traces to catalog/offer evidence; unsupported VIN/market input receives a useful fallback. Measure coverage separately from correctness. Visual search/plate lookup remain P3 experiments until coverage and rights justify them.

### Phase 4 — Buyer Retention & Marketplace Moat

Scope: I19/I20; strengthen I15 tracking/returns. Prioritize repeat jobs and reordering ahead of points/loyalty.

Deliverables: cross-device garage, consented alerts, repeat-order differences, workshop multi-vehicle job carts, bulk-number upload, invoices/POs and team permissions. Saved searches should notify meaningful availability changes, not daily non-updates.

Release gate: reorder revalidates identity, price, stock and compatibility; alert opt-out works; mixed-vehicle jobs retain correct line assignments; business users can recover invoices/orders across authorized devices; margin and wrong-fit return rate remain healthy.

### Measurement and experiments

Existing source emits `view_item`, `add_to_cart`, `begin_checkout` and server-confirmed `purchase`; preserve these. Add `search_submitted`, `search_interpreted`, `suggestion_selected`, `search_results_viewed`, `zero_results`, `filter_applied`, `vehicle_selected`, `fitment_state_viewed`, `verification_requested`, `shipping_quote_shown`, `checkout_step_completed`, `payment_attempt_result`, `order_lookup_failed`, `reorder_started` and `return_reason`.

Measure search → qualified PDP → add → checkout → paid, segmented by intent, vehicle completeness, origin/condition, device, new/returning and local/international destination. A qualified PDP is a relevant product identity with required fitment constraints resolved or explicitly acknowledged, not just any clicked result.

Core metrics: exact-number success; relevant top-five rate on judged queries; wrong-family/year result rate; zero-result recovery; time to confident selection; shipping-quote completion; checkout completion by step; paid-order conversion; wrong-fit returns; delivery-promise accuracy; support contacts per order; repeat purchase and workshop reorder time. Use contribution margin and disputes as guardrails—conversion alone can reward the wrong behavior.

Do not log VINs, phone numbers, addresses, OTPs or raw sensitive identifiers in general analytics. Use safe event IDs and coarse state; redact free-text queries that contain personal data. Deduplicate purchase events by transaction ID. Exclude audit/test sessions and fixtures.

First experiments after correctness fixes: compressed homepage versus current hierarchy; compact list versus two-column mobile cards; delivered-offer summary versus item-price-first presentation; explicit contextual verification CTA versus generic support. State the primary metric, minimum detectable effect, sample requirement and stopping rule before each test. Run across full business cycles; do not announce uplift from an underpowered short run. Policy accuracy, false fitment and hidden internal products are fixes, not A/B tests.

### Engineering handoff contracts

| Contract | Key responsibility | Likely implementation surface |
|---|---|---|
| Publishable inventory | Common exclusion/quality rules for all public retrieval paths. | API search/index/cache; homepage, suggestions and recommendations. |
| Product identity | Canonical part + typed MPN/OE relationships; origin distinct from condition. | Shared catalog contracts, ingestion, card/PDP view models. |
| Vehicle identity | Canonical make/model/year/configuration + alias mapping. | Vehicle APIs, picker, garage, migration tooling. |
| Fitment verdict | Evidence/qualifiers, selected vehicle, state and version. | Shared API contract; cards, buy box, cart, checkout snapshot. |
| Search state | Interpreted intent + exact constraints + safe relaxation; one applied URL model. | `/search/parts`, `/search/suggest`, existing v1 evaluation; filter helpers. |
| Effective offer | Seller, current availability, quantity basis, destination quote and policy version. | BuyBox, cart, shipping, checkout revalidation. |
| Order ownership | Authorized persistent order, shipment events and guest recovery. | Checkout/order API; success and purchase detail routes. |

Source starting points: `components/HeroSearch.tsx`, `Header.tsx`, `ProductCard.tsx`, `BuyBox.tsx`, `FitmentBadge.tsx`, `CartLineFitment.tsx`, `ReturnsPolicyNote.tsx`, `FilterSectionsClient.tsx`, `lib/fitment.ts`, `filter-params.ts`, `use-search-suggestions.ts`, `garage-context.tsx`, `app/search/page.tsx`, `app/checkout/page.tsx`, `app/checkout/success/page.tsx`, `app/account/purchases/[id]/page.tsx` in the buyer app; API search implementations in `apps/api/src/modules/search/`.

Update the app, shared-contract, checkout and search notes when these proposals are implemented. This audit does not change their current-state contracts.

## 20. PartsBazar360's Potential Competitive Advantage

**Become the most dependable way to turn a vehicle or part number into a purchasable, correctly matched UAE offer—with the reasoning, delivered cost and after-sale responsibility visible.** This is a focused product direction, not an unverified market-superiority claim.

The strongest opportunities, in order:

1. **Explainable fitment:** “This matches your configuration for these reasons; this detail still needs checking.” Competence is visible even when the answer is uncertain.
2. **Fast, precise number search:** exact identifiers, legitimate supersessions and compatible alternatives, with complete stock/quantity/delivery information.
3. **Local offer certainty:** real seller/location availability, honest delivery or freight quote, consistent returns and accountable resolution.
4. **Workshop memory:** repeat successful jobs, preserve customer-vehicle assignments and procure many parts without repeating the discovery process.

The defensible asset is the maintained graph connecting vehicle configurations, part identities, verified relationships, seller offers and fulfillment outcomes. AI can help query and explain that asset. It cannot substitute for it.

### Evidence directory and reproducibility

Saved browser captures, screenshots and read-only audit scripts: `outputs/ux-audit-2026-09-17/`. Key evidence:

- `desktop-home-viewport.jpg`, `mobile-home-viewport.jpg`, `home.txt`: first-screen hierarchy, internal listing and polluted brands.
- `autocomplete.jpg`, `autocomplete.txt`: partial-number suggestions and invisible matching tokens.
- `search-oem.txt`, `search-prefix.txt`, `search-name.txt`, `search-vehicle.txt`, `search-typo.txt`: search sample results.
- `garage-ui.json`, `garage-settled.txt`: duplicate makes/models and overlapping generation options.
- `pdp.txt`: BMW bumper copy, fitment, freight and related products.
- `pads-settled.jpg`, `pads-pdp.txt`: broken image and aftermarket/OEM title contradiction.
- `populated-cart.txt`, `populated-checkout.txt`, `mobile-checkout-viewport.jpg`: guest flow and returns/charge messaging.
- `filters-settled.jpg`, `filter-staged.txt`, `mobile-filters-settled.jpg`: filter interaction states.
- `runtime-errors.json`: no page-level JavaScript exceptions collected in the initial route pass; this does not imply network/media or transactional success.

**Verification details:** `verification.json` records filter URL transitions and a completed LP1305 image load with `naturalWidth=0`, confirming the media failure rather than merely an unfinished load.

External research is linked inline in the relevant sections. Live screenshots/source inspection take precedence over potentially older search-engine extracts. Findings are sample-based; expand category, seller and device coverage before estimating prevalence.

### Selected visual evidence

Desktop first screen, showing the duplicated search routes and prominent external-store action:

![Desktop buyer homepage](F:/apps/PartsBazar360/outputs/ux-audit-2026-09-17/desktop-home-viewport.jpg)

Settled aftermarket PDP, showing the failed image and OEM/brand-number contradiction:

![Delphi PDP evidence](F:/apps/PartsBazar360/outputs/ux-audit-2026-09-17/pads-settled.jpg)

Mobile results, showing identifier truncation, repeated badges and the floating support overlay:

![Mobile search results](F:/apps/PartsBazar360/outputs/ux-audit-2026-09-17/mobile-results-viewport.jpg)
