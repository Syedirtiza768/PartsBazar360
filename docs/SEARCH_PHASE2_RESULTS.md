# Search Phase 2 — Measured Results

**Date:** 2026-08-01
**Index:** `canonical_parts_v2` (built on production, **alias not swapped**)
**Baseline:** live `canonical_parts` via `https://partsbazar360.com/api/search/parts`, measured in
[`SEARCH_PHASE1_AUDIT.md`](SEARCH_PHASE1_AUDIT.md) §3.

The live buyer experience is **unchanged** — `parts_search` has not been promoted. Everything below
is the candidate index measured side by side with production.

---

## 1. Index build

| | live `canonical_parts` | new `canonical_parts_v2` |
|---|---:|---:|
| Documents | 125,859 | **140,539** |
| `searchNumbers` populated | 60,711 (48 %) | **140,537 (100 %)** |
| `interchangeNumbers` | 3,246 (2.6 %) | 3,246 (2.6 %) |
| Part type (real, not provenance) | — | 40,916 (29.1 %) |
| Image | 68,395 (54 %) | 83,335 (59.3 %) |
| Year facet | — | 76,047 (54.1 %) |
| Mapping | 100 % dynamic `text` | explicit, `strict`, nested offers |

- **+14,680 buyer-visible parts recovered.** 155,709 parts scanned, 15,170 correctly skipped for
  having no buyer-visible offer, **0 failures**, 434 s (≈340 parts/s).
- The 48 % → 100 % jump on `searchNumbers` is the fix for audit RC-1 and the root cause of §2 below.

## 2. Query acceptance probe

Same queries as the audit. "Before" is production today.

| Query | Before | After | Top result now |
|---|---|---:|---|
| `8640112020` | 3 · correct | 3 | ✅ correct part |
| `86401-12020` | 5 · **wrong** | **3** | ✅ correct part |
| `86401 12020` | 5 · **wrong** | **3** | ✅ correct part |
| `86401/12020` | 5 · **wrong** | **3** | ✅ correct part |
| `86401` (partial) | **0 results** | **3** | ✅ correct part |
| `A 221 820 02 64` | 3,742 · **wrong** | **5** | ✅ correct part |
| `a2218200264` | 4 · correct | 5 | ✅ correct part |
| `alternator` | 424 | 479 | alternator |
| `altrenator` (typo) | **0 results** | **448** | ✅ alternator |
| `tail light` | 983 | **422** | ✅ tail light |
| `taillight` | 22 | **410** | ✅ taillight |
| `2019 toyota corolla lane camera` | 5,834 · noisy | **24** | ✅ correct part |
| `LH headlight` | 2,807 · brackets/switches | **1,145** | ✅ actual headlight |

Every requirement in brief §2/§4 that was failing now passes:

- All four separator forms of an OEM number return the **same** correct part.
- Partial part numbers work.
- Manufacturer-spaced formats (`A 221 820 02 64`) work.
- Typos are tolerated.
- `tail light` and `taillight` now agree (422 vs 410, was 983 vs 22).
- Natural-language queries are precise (5,834 → 24) with the right part first.

## 3. Latency (30 queries, production hardware, 140 k docs)

| | measured | target (brief §21) |
|---|---:|---:|
| p50 | **23 ms** | < 150 ms |
| p95 | **102 ms** | < 400 ms |
| p99 | **108 ms** | < 800 ms |

Includes facet aggregations. Measured against 140 k documents on a single shard.

## 4. Three bugs the probe caught that the unit tests did not

Recorded because each was found only by running against real data, and each now has a regression
test.

1. **`minimum_should_match: "75%"` rounds down.** A two-token query required only one token, so
   "tail light" matched every listing containing "light". Fixed with the `"2<75%"` form (require all
   terms up to 2, then 75 %). Effect: `2019 toyota corolla lane camera` 5,816 → 79.
2. **The description clause had no `minimum_should_match` at all.** `match` defaults to OR, so any
   description containing "tail" *or* "light" matched — 3,548 results when only 225 documents have
   the phrase in their title. Fixed. Effect: `tail light` 3,548 → 422.
3. **Over-eager fuzziness.** Plain `AUTO` fuzzes 3-character words. Tightened to `AUTO:5,8` with
   `prefix_length: 3` so short words are matched exactly.

A fourth class was caught earlier by inspecting parser output rather than trusting green tests:
`2019 Toyota` was being joined into the bogus part number `2019TOYOTA`, and chassis/model codes
(`W221`, `F-150`) were being swallowed as part numbers.

## 4b. Follow-up round: make-constrained queries

Triggered by a reported bad result: searching **"Audi Bumper"** returned
*"Used OEM Audi Q7 Stone Guard 2007 7L0501559A"* — not a bumper.

Production baseline for `Audi Bumper`: **15,929 results**, where neither term was required —
#1 was a *Porsche* bumper vent grille, #2–#5 matched only "Audi" (stone guard, fender liner,
suspension valve, liftgate hinge), #6–#7 matched only "Bumper" (BMW, VW).

This exposed a bug introduced by the first pass: the parser strips the make out of the text query
and relies on the structured `makes` field — which is **empty on most salvage documents**. The
make constraint therefore vanished entirely, and `Audi Bumper` and `Audi Q7 bumper` returned the
*identical* 2,373 results including Nissan and MINI bumpers.

| Query | Production | First pass | Now |
|---|---:|---:|---:|
| `Audi Bumper` | 15,929 (Porsche, stone guard) | 2,373 (Nissan, MINI) | **2,315 — all Audi bumpers** |
| `Audi Q7 bumper` | — | 6,665 (*wider* than above) | **2,306 — narrower, Q7 first** |
| `BMW headlight` | — | — | **1,121 — all BMW headlights** |

Three fixes:

1. **`matchText`** — a new parser output: the whole query minus part numbers, years, and
   stopwords. Matching runs over this; `freeText` (make/model removed) still drives synonym
   lookup and part-type classification. Structured `makes`/`models` stay as *additional* boosts
   for the documents that have them.
2. **Stopword removal** — with "for" left in, `front bumper for 2018 Accord` matched
   *"FEBEST front brake caliper repair kit (set for one side)"* on front+for.
3. **`minimum_should_match: "3<75%"`** — requiring all terms up to 3 so that adding a term
   narrows the result set instead of widening it.

**Two-stage relaxation.** Strict matching returns almost nothing when the catalogue genuinely
lacks the part: `front bumper for 2018 Accord` collapsed to **1 result, a BMW X5 rear bumper**.
The service now re-runs the query relaxed when the strict set is below `SEARCH_RELAX_THRESHOLD`
(default 5) and labels it *"No exact matches for X — showing related parts"* rather than
presenting unrelated results as matches (brief §12).

One trade-off, recorded honestly: `2019 toyota corolla lane camera` moved from 24 → **1,064**,
because "toyota" and "corolla" are now required text terms rather than weak boosts on a mostly
empty field. Top results are still exactly right; recall is broader and make-correct.

## 4c. Indexing drift — measured, and why the outbox matters

The reconcile job (dry run, production) found the index already badly out of date **two hours
after** the rebuild:

```
expected (active offer)   115,870
in index                  140,539
missing from index          3,145
orphaned in index          27,814
outbox   {"DONE":198129,"PENDING":4246}  oldest pending: 9.2 hours
```

Verified independently in SQL: 115,892 parts now have an active offer, and `SellerOffer` has gone
from 158,666 rows at audit time to 132,714 — roughly **26,000 offers were deleted** by an
ingestion job in between. The catalogue is a fast-moving target.

This is exactly audit RC-7 in action, and it is the strongest argument for the outbox work: a
one-off reindex is stale within hours. The 4,246 PENDING rows are now **9.2 hours** old with no
consumer.

## 5. What is NOT done

Stated plainly so the state is not overclaimed.

- **The alias is not promoted.** Buyers still get the old index and old ranking. Promotion is a
  single command (`REINDEX_PROMOTE=1 node dist/src/reindex-search-v2.cli.js`) and rollback is an
  alias swap back.
- **`/api/v1/search` is written but not deployed.** `SearchV1Service` + `SearchV1Controller` +
  `SearchQueryDto` exist and are unit-tested; they have not been exercised against a running API
  because that needs an API redeploy.
- **Facet counts are unverified against live data.** The exclusion logic is implemented and
  unit-tested; it has not been measured end to end.
- **The indexing fix is written but not deployed.** `SearchIndexerService`,
  `SearchOutboxService` (claim / backoff / dead-letter / stats), `SearchOutboxRunner`, and the
  reconcile CLI exist and are unit-tested (14 tests covering the exact production failure: a row
  must not be marked DONE when the index write throws). The worker container does not yet run
  this code, so the 4,246 PENDING rows are still undrained.
- **The reconcile repair has not been applied.** It has only been dry-run. Applying it would
  enqueue 3,145 UPSERT + 27,814 DELETE rows into a queue that currently has no consumer, so it
  must wait until the worker is deployed.
- **Existing write paths still hand-build their own `indexPart` payloads** and have not been
  switched to `outbox.enqueue()`. That change is deliberately deferred until the alias is
  promoted, so the legacy index keeps being maintained in the meantime.
- **Frontend is untouched.** No interpretation summary, no did-you-mean, no new facet groups.
- **Part-type coverage is 29.1 %.** Honest partial coverage from title classification; the other
  71 % have no part type and are simply absent from that facet rather than bucketed into a
  meaningless "General".
- **Trim/engine/transmission/drivetrain filters are deliberately not built** — all 28,531
  `VehicleConfiguration` rows have those columns empty (audit RC-6). Shipping those controls would
  present unverified compatibility as fact.

## 6. Promotion runbook

```bash
# 1. Re-verify the candidate (safe, read-only)
sudo docker exec partsbazar360-api-1 node dist/src/probe-search-v2.cli.js

# 2. Promote — atomic alias swap, no downtime
sudo docker exec -e REINDEX_PROMOTE=1 partsbazar360-api-1 \
  node dist/src/reindex-search-v2.cli.js

# 3. Rollback if needed — alias back to the previous index, seconds
curl -X POST localhost:9200/_aliases -H 'Content-Type: application/json' -d \
  '{"actions":[{"remove":{"index":"canonical_parts_v2","alias":"parts_search"}},
               {"add":{"index":"canonical_parts","alias":"parts_search"}}]}'
```

Note that step 2 re-runs the full scan before swapping, so it is also the way to refresh the
candidate. `verifyBeforeSwap` blocks the swap if the candidate holds less than 95 % of the live
document count.
