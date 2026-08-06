# Agent instructions — PartsBazar360

These rules apply to **any** AI agent or model working in this repo (Claude, Codex, Copilot, Cursor, Gemini, etc.) — not just Claude Code. If your tool has its own instructions file (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, ...), it should point back here rather than duplicating this content, so there's one place to keep current.

## Before non-trivial work
Read [docs/Home.md](docs/Home.md). It's the map-of-content for an Obsidian vault rooted at this repo (`docs/`), linking a note per app (`docs/apps/`), per shared package (`docs/packages/`), and a decision log (`docs/decisions.md`).

## After non-trivial work
If the change is architecturally significant — a new module, a changed data flow, a cross-app contract change, a non-obvious workaround — update the matching note (or add an entry to `docs/decisions.md`) **before** considering the task done. Bump that note's `Last reviewed:` date even if the content didn't need to change.

## Enforcement
A git pre-commit hook (`scripts/check-docs-freshness.mjs`, installed via `simple-git-hooks` — runs automatically after `npm install`, for any tool or human committing) checks staged diffs against `apps/*/src`, `apps/*/prisma`, `apps/*/scripts`, and `packages/*/{src,cli}`. If it judges a docs update is warranted and none was staged, it **blocks the commit**. This fires regardless of which agent made the change, since it's enforced by git itself.

- The check calls the local `claude` CLI non-interactively to judge the actual diff (not just path-matching), to keep false positives/negatives low. If that CLI isn't available or isn't authenticated, it fails safe into a blocking generic reminder instead of silently passing.
- Override (only after actually checking): `SKIP_DOCS_CHECK=1 git commit ...`
- This is a local hook, so it can be bypassed with `git commit --no-verify`. The periodic staleness audit (see below) is the backstop for anything that slips past it — don't rely on the hook alone.

## Backstop: periodic staleness audit
A scheduled agent periodically diffs recent git history against `docs/` and reports notes that look out of date, independent of whether any individual commit's hook fired. See the schedule config for cadence; treat its findings as a todo list, not noise to dismiss.
