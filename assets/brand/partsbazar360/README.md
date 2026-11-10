# PartsBazar360 identity assets (draft v1.0)

The Hex P identity. Brand book: `presentation/index.html` (also a private artifact: https://claude.ai/artifact/6m6FwD1gAkGtUHsD4AtZWR). Vault note: `docs/brand/partsbazar360-logo.md`.

Status: draft for approval. Not trademark-searched. Pantone references are unvalidated candidates.

## Naming

`partsbazar360_{layout}_{colourway}_{size}.{ext}`

- layout: `horizontal`, `stacked`, `symbol`, `wordmark`, `production-horizontal`, `appicon_*`, `avatar`, `symbol_micro16`
- colourway: `fullcolor` (petrol + graphite), `reversed` (for dark grounds), `mono-black`, `mono-white`, `plate`
- size: `1200w` (pixel width) or `512h` (pixel height); vector files have no size

## Which file to use

| Need | File |
|---|---|
| Website header, documents | `svg/partsbazar360_horizontal_fullcolor.svg` |
| Dark header or footer | `svg/partsbazar360_horizontal_reversed.svg` |
| Square space | `svg/partsbazar360_stacked_fullcolor.svg` |
| Icon only, 24 px and up | `svg/partsbazar360_symbol_fullcolor.svg` |
| Browser tab | `favicon/favicon.ico`, `favicon/favicon.svg` |
| PWA / Android / iOS | `favicon/`, `app-icons/` |
| Printer, signage, packaging | `pdf/` (CMYK) or `eps/` |
| Embroidery, engraving | `pdf/partsbazar360_production-horizontal_mono-black.pdf` |
| Over photography | `svg/partsbazar360_horizontal_plate.svg` |
| Social profile, WhatsApp | `social/` |

## Rebuild

From the repo root:

```bash
python assets/brand/partsbazar360/source/build_identity.py
node assets/brand/partsbazar360/source/render_assets.cjs
python assets/brand/partsbazar360/source/build_presentation.py
```

Needs Python with `fontTools` and `brotli`, plus the repo's installed `node_modules` (for `sharp`).

## Known gaps

No `.ai` master. The PDFs open as editable vectors in Illustrator, Affinity and Inkscape. The EPS files are not render-tested. Embroidery and print colour need physical proofs.
