# @repo/catalog-contracts

**Last reviewed:** 2026-08-12

Shared types/schemas for the parts catalog, consumed by [[../apps/api]], [[../apps/buyer-marketplace]], [[../apps/seller-portal]], and [[../apps/admin-portal]] (notably **not** [[../apps/workshop-portal]] — see that note).

This is the contract boundary between the backend and the frontends — changes here ripple across every app that imports it. Treat schema changes as cross-app changes, not local ones.

## Open questions / TODO
- Document the actual shape of the core catalog entities (part, listing, compatibility/fitment, brand) once you're working in here.
- Link this note to [[../MOTOR_PARTS_CATALOG_ARCHITECTURE]] entity-by-entity.

## SEO engine (`src/seo/`)

Since 2026-08-12 this package also carries the **programmatic SEO engine** — see
[[../SEO_ARCHITECTURE]] for the full picture.

It lives here rather than in any one app because the API (slug assignment,
sitemap feeds, health) and the buyer storefront (metadata, JSON-LD,
breadcrumbs) must derive SEO from *identical* rules; a second implementation is
a guaranteed drift. The engine is deliberately **pure** — no Prisma, no Next, no
React — so the same functions run in a NestJS request, a CLI backfill, a Next.js
server component, and Jest.

Entry points most callers need:

- `buildPartSeoDocument(part)` / `buildTaxonomySeoDocument(node)` — one call in,
  one render-ready `SeoDocument` out (canonical, title, H1, description, robots,
  breadcrumbs, images + ALT, OG/Twitter, JSON-LD, internal links).
- `buildPartSlugBase()` / `resolveUniqueSlug()` — slug generation.
- `decidePartIndexability()` / `decideTaxonomyIndexability()` / `decideFacetIndexability()`.
- `validatePartSeo()` — the same checks the API health endpoint runs.

**Note on tests:** `apps/api`'s jest maps `@repo/catalog-contracts` to this
package's **source**, not `dist/`. Before that mapping existed, a spec was
silently passing against a stale build.
