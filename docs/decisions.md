# Decision log

**Last reviewed:** 2026-08-06

Running log of non-obvious decisions, workarounds, and their reasons. Newest first. Add an entry whenever a change is driven by something that isn't obvious from the code alone (a past incident, an external constraint, a workaround for a broken dependency).

Format:
```
## YYYY-MM-DD — Short title
**Decision:** what was decided/done.
**Why:** the constraint or incident that drove it.
**Revisit when:** condition under which this should be reconsidered (optional).
```

---

## 2026-08-06 — Checkout defaults to email OTP, not SMS
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
