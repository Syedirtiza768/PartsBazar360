# PartsBazar360 identity (draft v1.0)

Last reviewed: 2026-10-25

The PartsBazar360 identity system: the Hex P symbol, the PartsBazar360 wordmark, a ten-variant logo family, and print, digital and app assets. It is a draft for approval, not a cleared mark. No trademark search has been done, and the Pantone references are unvalidated candidates. The GBC Atlas character is a separate set of assets ([[brand/gbc-atlas]]) and is not used here.

The full brand book (research, five concepts with scores, construction, applications, standards, QA) is `assets/brand/partsbazar360/presentation/index.html`. It is also published as a private artifact: https://claude.ai/artifact/6m6FwD1gAkGtUHsD4AtZWR

## The mark

- **Hex P.** A pointy-top hexagon ring is the bowl of a P, and its left edge continues down as the stem. The counter is a concentric hexagonal bore whose left edge lines up exactly with the stem's inner edge. The stem ends in a 30° cut parallel to the bowl's lower-right edge (a hex-key end), so every angle in the mark is 0°, 30°, 60° or 90°.
- **Meaning.** P for parts. The hexagon is a nut, the part every vehicle shares. The bore is the fit. Six sides of 60° make the 360.
- **Geometry** (symbol units, from `source/geometry.json`): bowl circumradius R = 31, stroke and stem T = 16, bore r = 12.525, symbol 53.69 × 92. Wordmark cap height = 1.5R (hexagon shoulder to base), gap = bore width, clear space X = bore height.
- **Wordmark.** `PartsBazar360` in Roboto Condensed at weight 720 (the buyer app's `--font-display` face), outlined to paths and kerned from the font's GPOS table. `360` is set in petrol at the same weight.
- **16 px.** A separate hand-drawn favicon (`svg/partsbazar360_symbol_micro16.svg`) uses a pixel-aligned slot counter, because a 2 px hexagon blurs shut.

## Colour

Unchanged from `packages/ui/tailwind-preset.cjs`, so the logo and the product stay one system: petrol `#116b6b` (symbol, 360), graphite `#0d1519` (wordmark), petrol light `#3ba49f` on dark grounds, canvas `#f4f2ed`. Safety orange stays out of the logo; [[DESIGN_SYSTEM]] reserves it for actions and wayfinding. CMYK builds in the PDF and EPS masters are starting points that need a press proof.

## Files

Everything lives in `assets/brand/partsbazar360/` and regenerates from `source/`. The folder's README lists every directory and the naming rule. Run the steps in order:

1. `python assets/brand/partsbazar360/source/build_identity.py` writes the SVG, PDF and EPS masters, the concepts, the construction drawing and the presentation defs.
2. `node assets/brand/partsbazar360/source/render_assets.cjs` writes the PNG, WebP, favicons, app icons, social images and QA proofs (uses the repo's `sharp`).
3. `python assets/brand/partsbazar360/source/build_presentation.py` assembles the brand book.

## Open items

- **Wired in.** All four apps serve the favicon set (`app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`) and show the horizontal lockup: the buyer header and drawer, and the admin, seller and workshop rails through the shared `AppShell` `logo` prop. The workshop rail is dark and uses the reversed lockup. `site.webmanifest` is not wired; PWA install behaviour is a separate decision.
- **Not done:** trademark search and legal review (UAE, GCC and export markets, Nice classes 12 and 35); Pantone validation; embroidery stitch-out; press proofs; an Arabic companion lockup.
- **No AI file.** EPS files were generated but not render-tested, because no PostScript interpreter was available. The PDFs were rendered back and verified.
