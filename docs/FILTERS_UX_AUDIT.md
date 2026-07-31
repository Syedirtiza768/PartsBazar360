# Marketplace Filters UI/UX Audit

**Scope:** PartsBazar360 buyer search, desktop and mobile  
**Benchmark:** high-volume marketplace discovery patterns used by Amazon and eBay, adapted for automotive fitment  
**Date:** 2026-08-01

## Improved execution brief

> Audit and upgrade the PartsBazar360 search-filter experience to state-of-the-art marketplace quality. Benchmark the interaction model against Amazon and eBay without copying their visual design. Evaluate desktop and mobile information architecture, facet relevance, selected-state visibility, counts, sorting, clearing behavior, result feedback, empty-state recovery, accessibility, responsiveness, URL persistence, SEO, and performance. Prioritize automotive intent: exact/OE number matching, fitment, part type, brand, condition, price, availability, delivery, and seller trust. Preserve accurate post-filter counts, multi-select logic, crawlable URLs, and all existing vehicle/fitment flows. Implement the highest-impact safe improvements, verify keyboard/touch behavior and 320px-to-desktop layouts, and document the remaining backend or data dependencies with measurable acceptance criteria.

## Executive assessment

The foundation is stronger than the visual UI initially suggests. Facets are server-backed, counts are scoped to the other active filters, selections survive refresh in the URL, multi-select logic is correct, and the controls still work without JavaScript. Those are difficult marketplace fundamentals and should be preserved.

The experience was not yet top-tier because several small interaction failures accumulated: the mobile drawer closed after every selection, selected values could be hidden under **Show more**, clearing filters could also erase the buyer's search, Category was polluted by vehicle makes and non-part buckets, and the live facet model exposes too few buying-decision dimensions.

### Baseline scorecard

| Dimension                      | Baseline | Notes                                                                                 |
| ------------------------------ | -------: | ------------------------------------------------------------------------------------- |
| Facet accuracy and URL state   |     8/10 | Multi-select, scoped counts, crawlable links, refresh-safe state                      |
| Information architecture       |     5/10 | Weak ordering; internal source terminology; key commerce facets absent                |
| Selected-state clarity         |     5/10 | Applied chips exist, but a selected option could be collapsed out of sight            |
| Desktop efficiency             |     6/10 | Sticky sidebar works; lacks a strong filter header and relevance ordering             |
| Mobile efficiency              |     4/10 | Drawer closed after every tap, forcing repeated open-select-open cycles               |
| Result feedback                |     7/10 | Accurate range/total and count badges; mobile action lacked result total              |
| Clear/recovery behavior        |     5/10 | Clear-all unexpectedly removed the buyer's query                                      |
| Accessibility                  |     7/10 | Touch targets, focus trapping, labels, and non-color selected state are good          |
| Marketplace decision coverage  |     4/10 | No condition, price, availability, delivery, returns, or seller facets in the live UI |
| Performance and SEO resilience |     8/10 | Server rendering, shallow URL state, no-JS links, and bounded facets are strong       |

**Overall baseline: 5.9/10.** The implemented interaction pass raises the current facet set to roughly **7.5/10**. Reaching 9/10 requires promoting and validating the richer search API/data model described below.

## Benchmark principles

eBay explicitly treats left-rail refinements such as item specifics, condition, buying format, returns, shipping, and location as core search tools, with sorting as a separate control ([eBay search guidance](https://www.ebay.com/help/default/default/default?id=4006)). Its automotive category pages additionally demonstrate context-specific facets such as placement, material, brand type, condition, and price.

The useful Amazon/eBay lesson is not visual imitation. It is a behavior contract:

1. Keep high-intent refinements closest to the results.
2. Never hide an applied value.
3. Preserve the shopper's query when clearing refinements.
4. Show the consequence of an action before or immediately after it is taken.
5. Make mobile refinement a continuous session, not a repeated drawer-opening task.
6. Put commercial decision filters (condition, price, delivery, returns) alongside taxonomy filters.

For PartsBazar360, vehicle fitment and part-number identity must rank above generic marketplace facets.

## Implemented in this pass

- Mobile filters now remain open while the URL and counts update, so buyers can make several refinements in one session.
- The pinned mobile action reports the current result total and includes a direct clear action.
- Facet contents are ordered alphabetically by the label buyers see.
- Category now shows only recognized car-part families, filtering out make-name and generic buckets.
- Every group shows its own applied-count badge.
- **Show more** changes to **Show fewer** when expanded.
- Clearing refinements preserves the search query, sort, and page-size preference.
- Exact-number-only mode is counted and represented as a removable applied chip.
- Facets are reordered around shopper intent: category, part type, brand, fitment make, then tag.
- The source-tag filter is labelled **Tag**.
- The desktop rail gains a clear heading, divider, and contextual **Clear filters** action.
- Applied chips scroll horizontally on narrow screens rather than growing into a tall block.
- The low-priority page-size control is hidden on small screens, preventing a three-control toolbar squeeze at 320px.
- Filter controls remain ordinary links, preserving keyboard activation, crawlability, and no-JavaScript fallback.

## Remaining gap to state-of-the-art

The repository already contains a candidate versioned search API and index fields for condition, price, seller, image availability, stock, year, model, and additional automotive attributes, but the production runbook states that the new index alias and API have not been promoted or end-to-end validated. The UI should not pretend those dimensions are live before that rollout.

### P0: promote the richer search contract safely

- Deploy and probe `/api/v1/search` against the candidate index.
- Validate facet exclusion logic and totals on real data.
- Promote the search alias with a measured rollback window.
- Switch the buyer page only after response-shape compatibility is verified.

**Acceptance:** selected condition/price/availability filters return matching cards, facet counts remain consistent, and production search latency stays within the measured target.

### P1: add the buying-decision facets

Recommended order after fitment context:

1. Condition
2. Price range, with useful suggested bands plus min/max inputs
3. Availability: in stock, item has photo
4. Seller or inventory source
5. Delivery destination/speed and free shipping when trustworthy data exists
6. Returns accepted and warranty when seller policy data is normalized

**Acceptance:** every visible facet is backed by reliable indexed data; no control is shown for sparse or unverified fields.

### P1: make long facets searchable

Add an in-group text search for brand, model, and seller lists when a group exceeds roughly 12 values. Keep applied values pinned above matching results.

**Acceptance:** a keyboard or touch user can reach any value without expanding and scanning dozens of rows.

### P1: fitment-first refinement

When a garage vehicle is active, show a persistent fitment summary above generic facets and offer an explicit **Only parts verified to fit** control. Do not infer trim/engine filters from incomplete data.

**Acceptance:** fitment state and evidence are named; uncertainty is never presented as a confirmed match.

### P2: measurement

Instrument filter open, facet select/remove, clear, zero-result, reformulation, result click-through, and time-to-first-product-click. Segment by viewport and whether a vehicle is selected.

**Success targets:** reduce mobile repeated drawer opens, reduce zero-result exits, and improve product click-through after a refinement without increasing filter-induced zero-result sessions.

## Guardrails

- Do not copy Amazon or eBay styling; preserve PartsBazar360's Workshop Ledger design language.
- Do not add a filter simply because the field exists. Only expose dimensions with trustworthy coverage.
- Keep OR within one facet and AND across facets.
- Keep filter state shareable in the URL and reset pagination when a refinement changes.
- Maintain visible focus, 44px touch targets, text-based selected state, and safe-area-aware drawer actions.
- Never use fitment color alone and never label inferred compatibility as verified.
