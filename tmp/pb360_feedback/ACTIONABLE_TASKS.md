# PB360 Feedback Action List

## High priority

1. Replace placeholder checkout shipping with EMX country and weight rates.
   - Status: implemented in checkout API and buyer checkout UI.
   - Follow-up: confirm unsupported-country fallback policy with operations.

2. Validate search-result matching accuracy.
   - Inspect interchange, brand, and fitment ranking against known sample searches.
   - Add a QA list of false-positive and false-negative examples.

3. Fix the `Aftermarket` filter path that produced empty results.
   - Re-test the exact search page and query where the issue was reported.
   - Compare storefront filter params with backend search filtering and facet generation.

4. Improve part-detail fitment coverage so all compatible vehicles are clearly shown.
   - Re-check the reported PDP against the OEM comparison link.
   - Verify whether missing vehicles are absent from source data or hidden by UI logic.

## Product decisions needed

5. Decide whether to expose `eBay item ID` on product pages.
   - Current code already supports rendering a marketplace item ID when present.
   - Product/ops decision still needed on visibility and copy.

6. Decide guest checkout scope.
   - Current checkout requires sign-in.
   - Decision needed on guest orders, account linking, and post-purchase tracking.

7. Decide social login providers.
   - Current login is email/password only.
   - If approved, define provider order and region/privacy constraints.

8. Approve Tabby and Tamara integration.
   - No current implementation found.
   - Needs commercial, legal, and technical scoping before build.

## UX enhancement

9. Add header currency auto-selection with manual override.
   - Current storefront formats prices but does not expose geo-based currency switching.
   - Requires geo source, persistence, and price-conversion strategy.
