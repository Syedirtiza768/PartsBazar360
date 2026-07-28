# PB360 Feedback vs Current Codebase

## Present in code already

- Fitment UI exists on the part page via `CompatibilitySection`.
- The search UI exposes an `Aftermarket` part-type filter in `FilterSidebar`.
- Product pages can show `ebayItemId` when the part record has one.
- Checkout and payment already flow through authenticated checkout plus Stripe.

## Present but likely needs QA/fixes

- Matching accuracy: search and interchange logic exist, but the feedback suggests result quality needs validation.
- Fitment display: the PDP has verified/advisory/table sections, but the reported listing may still be incomplete or misleading.
- Aftermarket filter: the storefront renders the filter, so the reported failure is likely in backend filtering, data quality, or a specific filter combination.

## Missing or not implemented

- Header currency auto-detect and user currency switcher.
- Guest checkout.
- Google, Facebook, and Apple sign-in.
- Tabby integration.
- Tamara integration.

## Implemented from this pass

- Replaced mock shipping math with EMX rate-sheet quoting by destination country and billable weight.
- Added a checkout shipping quote endpoint for previewing totals before payment.
- Updated buyer checkout UI to show estimated shipping and estimated total.
