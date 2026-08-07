# Decision log

**Last reviewed:** 2026-08-07

Running log of non-obvious decisions, workarounds, and their reasons. Newest first. Add an entry whenever a change is driven by something that isn't obvious from the code alone (a past incident, an external constraint, a workaround for a broken dependency).

Format:
```
## YYYY-MM-DD — Short title
**Decision:** what was decided/done.
**Why:** the constraint or incident that drove it.
**Revisit when:** condition under which this should be reconsidered (optional).
```

---

## 2026-08-07 — Checkout verification is transaction identity, not login

**Decision:** Checkout resolves a dedicated `Customer` from an OTP-verified
E.164 phone and issues a cart-bound checkout token. It does not issue a normal
account token or require a password. Orders attach to the customer whether the
linked `User` account exists, is logged out, or is created after payment.

**Why:** Conflating OTP verification with login interrupted existing customers,
leaked account existence, created bare authentication rows before ownership was
proven, and made guest history unreliable. Purchase completion must take
priority while account data remains protected.

**Compatibility:** Legacy `buyerId`, `PaymentIntent`, email/password login,
shipping lead times, freight gating, fitment confirmation, and returns policy
remain intact during rollout. See [[CHECKOUT_GUEST_FIRST]].

---

## 2026-08-07 — Search outbox wired into real write paths (uploads, inventory, ingestion)
**Decision:** `merchant/uploads.service.ts`, `merchant/inventory.controller.ts`, and the three
indexing call sites in `ingestion/ingestion.processor.ts` now call `SearchOutboxService.enqueue()`
in addition to their existing synchronous `OpenSearchService.indexPart()` calls. The legacy
(buyer-facing, `/search/parts`) index is untouched — same synchronous best-effort call as before.
This only gives the v2 outbox/index (`SearchIndexerService`, not yet promoted to the buyer-facing
alias) real producers, so it stays current instead of drifting stale until the next full CLI
reindex. `uploads.service.ts` also had its old create-PENDING-then-immediately-force-DONE block
removed — that was the literal RC-7 bug the outbox was built to fix (see
`search-outbox.service.ts`'s file header): it faked completion without ever calling the real
indexer.
**Why:** `docs/SEARCH_PHASE2_RESULTS.md` (§5, 2026-08-01) had explicitly deferred this wiring until
alias promotion, on the grounds that the worker wasn't yet running the outbox runner. That's no
longer true — `SearchOutboxRunner` is built, unit-tested (14 passing tests), and runs by default in
any worker process with `RUN_INGESTION_WORKER=1` (every deployed worker container). Queuing rows
now is safe because they're actually drained, not orphaned.
**Revisit when:** the `parts_search` alias is promoted — at that point the legacy
`OpenSearchService.indexPart()` calls become dead code and should be removed from all four sites.

## 2026-08-07 — Shipping lead-time falls back to a conservative estimate, not null
**Decision:** `checkout/shipping.service.ts`'s `quoteSellerShipping` now returns
`AVERAGE_LEAD_TIME` ("08 to 14 Business Days" — the widest window on the EMX sheet) instead of
`leadTime: null` for destinations with no EMX rate-sheet row, mirroring how `amount` already falls
back to `averageRates` for the same countries.
**Why:** Looked like a `COUNTRY_ALIASES` coverage gap at first (~30 dropdown countries unmatched),
but diffing `SHIPPING_COUNTRIES` against `EMX_RATE_SHEET` showed `COUNTRY_ALIASES` already covers
every real naming mismatch (9 entries) — the remaining unmatched countries (Kosovo, Libya, Syria,
Monaco, Vatican City, etc.) simply have no row in the sheet at all, so no alias could fix them. The
actual inconsistency was that price got an average fallback but lead time silently got none, so
"Est. delivery" just vanished for those destinations even though a price was quoted.
**Revisit when:** EMX adds coverage for any of the currently-absent countries — remove them from
this reasoning, no code change needed (they'll just start matching `rowsByCountry`).

---

## 2026-08-07 — SMS OTP provider switched from Twilio to SMSGlobal
**Decision:** Checkout ([[apps/buyer-marketplace]] + [[apps/api]] `auth`/`sms` modules) sends phone OTP via the SMSGlobal REST API (`SMSGLOBAL_API_KEY`/`SMSGLOBAL_API_SECRET`/`SMSGLOBAL_SENDER_ID`) instead of Twilio Verify, and defaults back to SMS as the checkout verification channel (email remains the fallback).
**Why:** Twilio's account was stuck on a trial-only SMS restriction (see the superseded 2026-08-06 entry below). SMSGlobal is a plain send API rather than a hosted verify service, so OTP code generation/storage/expiry now lives in `AuthService.sendPhoneOtp`/`verifyPhoneOtp` (reusing the `otpCode`/`otpExpiry` `User` columns), mirroring the email OTP flow instead of delegating to the provider.
**Revisit when:** N/A unless SMSGlobal delivery becomes unreliable, in which case flip `SMS_CHANNEL_ENABLED` in `checkout/page.tsx` back to `false`.

## 2026-08-06 — Checkout defaults to email OTP, not SMS *(superseded 2026-08-07)*
**Decision:** Checkout ([[apps/buyer-marketplace]] + [[apps/api]] `auth`/`sms` modules) defaults to email OTP for verification.
**Why:** Twilio SMS delivery is currently down/unreliable.
**Revisit when:** Twilio SMS is confirmed stable again — re-enable SMS as an option rather than leaving email as the sole path.

## Local dev runs against the deployed stack, not Docker
**Decision:** Frontends are run locally against the already-deployed backend stack rather than a full local Docker Compose setup.
**Why:** Faster iteration; avoids running the full stack locally. Two gotchas that came out of this: the image proxy can't accept encoded URLs, and Turbopack has a cache gotcha that can serve stale output — see Claude's memory (`dev-workflow-no-docker.md`) for specifics before debugging "it's not updating" issues.

## Deploys must go through `update.sh`, not bare `docker compose up --build`
**Decision:** Always deploy via `update.sh`.
**Why:** A bare `docker compose up --build` skips the nginx reload step, which 404s the buyer site even though the containers look healthy.

## Long-running jobs need a standalone container, not `docker exec`
**Decision:** Run long jobs (e.g. reindex) via `docker run` on the app network, not `docker exec` into an existing container.
**Why:** `docker exec` jobs get killed if the container is recreated mid-job (e.g. by a deploy), silently losing progress.

---

*(These four entries were backfilled from Claude's memory store and recent commit history when this log was created. Keep adding to it going forward — don't let it go stale.)*
