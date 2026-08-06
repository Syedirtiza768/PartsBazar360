# @repo/scraper-engine

**Last reviewed:** 2026-08-06

eBay/supplier scraping and enrichment engine. Backs the root `scrape:ebay` script (`packages/scraper-engine/cli/ebay-store.js`) and the various `enrich:*` / `seed:realtrack-dynatrade` / `seed:salvagea` / `seed:blackline` CLIs in [[../apps/api]].

Related root-level state/output that isn't part of this vault (excluded from the Obsidian file explorer, but worth knowing about):
- `.ebay-scraper/`, `.ebay-scraper-blackline/`, `.scraper-state/` — scraper working state
- `exports/`, `outputs/` — scrape/export output
- Root-level `dynatrade_brand_map.json` / `.tsv`, `*_export*.csv` files — one-off data pipeline artifacts, not source of truth for anything

## Open questions / TODO
- This note is a stub. Document the actual scrape → enrich → seed pipeline stages and which supplier (Dynatrade, RealTrack, Salvagea, Blackline, Febest, DXB, Partsouq, MVL) each script targets.
