# enrichment-workbench

**Last reviewed:** 2026-08-14

Local-only review application for enriching every active Superior Auto Parts
listing before approved changes are taken back to the main marketplace. It
lives at `apps/enrichment-workbench` and runs on port 3004.

## Workflow

1. `npm run prepare-data --workspace enrichment-workbench` creates a read-only
   local index under `tmp/superior-enrichment-workbench/` from the current
   Superior active-listings export and checked-in enrichment working files.
2. The catalogue view exposes all Superior listings with searchable queues for
   incomplete titles, images, and vehicle compatibility. Complete SEO titles
   use `Brand | Short description + MPN | OE number | Fits Make Model`.
3. Compatibility lookup follows a strict evidence hierarchy: genuine OE first,
   then exact normalized Brand + MPN when OE is unavailable. A Brand + MPN match
   is accepted only when the catalogue record has `CONFIRMED` fitment with
   confidence of at least 0.85. A successful lookup fills the reviewed fitment
   rows and builds a concise title from the part brand, description/MPN, OE when
   available, and up to three verified make/model pairs.
4. For unresolved no-OE pairs, `scripts/enrich-mpn-with-luna.mjs` researches the
   exact Brand + MPN through OpenRouter's `openai/gpt-5.6-luna` model with web
   search enabled. It writes resumable JSONL evidence, applies only identity and
   fitment results at confidence 0.85 or higher, and respects the configured
   `ENRICHMENT_DAILY_BUDGET_USD` (override with `LUNA_MPN_BUDGET_USD`).
5. The High-confidence fitment tab reads the accepted Luna JSONL evidence as a
   read-only, searchable, paginated queue. Each row shows identity and fitment
   confidence, exact vehicle applications, OE references, and available sources.
6. Operators edit one listing at a time. Drafts and approvals are persisted in
   a separate local edits file; source CSVs and the production application are
   never mutated.
7. Approval is rejected unless all title components pass, the title is at most
   160 characters, an HTTP(S) image exists, and either a valid make/model/year
   compatibility row or an explicit universal-fit declaration exists. The OE
   and make/model named in the title must match the separately stored values.
8. The export endpoint emits only approved rows, including the reviewed OE
   number, and includes the source update timestamp so a future production
   importer can detect stale writes.

## Data shape and scaling

The generated catalogue index keeps listing summaries, title suggestions,
current images, and image candidates in memory for fast filtering across the
full catalogue. Existing compatibility is held in a byte-offset side index and
loaded only when a listing is opened. Separate normalized OE and exact Brand +
MPN indexes point to those same offsets. Both include only enrichment records
with `CONFIRMED` fitment and confidence of at least 0.85; an aftermarket MPN is
excluded from OE lookup unless the source identifies the part as OEM. OE and
MPN values are therefore lookup keys into existing fitment evidence, not proof
by themselves. This avoids loading the roughly 1 GB normalized compatibility
archive into memory while preserving its complete row sets.

The bulk builder writes a four-section suggestion for every listing. Missing
evidence is stated explicitly as `OE not available` or `Fitment not confirmed`;
vehicle applications are never inferred from an unverified number. Source
labels such as `OE`, `OEM`, `Unknown`, and `Genuine OEM` are not treated as
brands. A known catalogue brand is recovered from the source title only when it
matches a known brand exactly at the start; otherwise the title says
`Unbranded`.

The source export currently contains 60,923 active Superior listings. At the
2026-08-14 final index build, all 60,923 had complete title suggestions, 36,170
had current images, 23,572 had compatibility rows, 12,408 had confirmed fitment
suitable for titles, and 9,517 had an OE number. Luna evidence contributed 1,123
titles with verified fitment, 1,794 with verified part descriptions, and 772
recovered OE references across 2,348 accepted evidence records. The evidence
indexes contain 9,300 normalized OE keys and 11,101 exact Brand + MPN keys. The
remaining 51,406 titles say `OE not available`, and 48,515 say `Fitment not
confirmed`. These counts are operational observations, not hard-coded assumptions;
rebuilding the index recalculates them.

## Safety boundary

This is intentionally not connected to production write APIs. The approved CSV
is a handoff artifact, not an automatic deployment mechanism. A separate,
explicit importer should validate listing identity and `source_updated_at`
before applying any approved change to the main database.

## Depends on

- The latest Superior active-listings CSV export at the repository root.
- Existing Superior title, image, and compatibility enrichment outputs.
- [[api]] for the eventual controlled production import contract.
