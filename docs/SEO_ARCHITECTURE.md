# SEO Architecture

**Last reviewed:** 2026-08-12

How PartsBazar360 generates SEO. The governing idea: **SEO is a property of the
domain, not of the page templates.** Nothing about a listing's URL, metadata,
schema, breadcrumbs, links, indexability, or sitemap membership is configured
per listing — all of it is derived from the listing's own data by one shared
engine, so a listing created by any means inherits the whole system.

Related: [[apps/api]], [[apps/buyer-marketplace]], [[packages/catalog-contracts]], [[decisions]]

---

## 1. Where the logic lives

```
packages/catalog-contracts/src/seo/     ← the engine (pure, no Prisma/Next/React)
├── config.ts          central configuration: site, limits, thresholds, rules
├── types.ts           input contracts (SeoPartInput, SeoTaxonomyInput, SeoOverrides)
├── text.ts            safe join/clip/dedupe primitives — no `undefined` can escape
├── slug.ts            slug generation, uniqueness, reserved words
├── url.ts             every public URL + canonical normalisation
├── indexability.ts    the index/noindex decision engine
├── metadata.ts        title / description / H1 generation + fallback chains
├── image.ts           ALT text, ordering, LCP priority, social image selection
├── taxonomy.ts        derives a listing's taxonomy from its own attributes
├── breadcrumbs.ts     trail generation (feeds both the <nav> and the JSON-LD)
├── schema.ts          JSON-LD builders
├── internal-links.ts  taxonomy links + attribute-scored related products
├── sitemap.ts         sitemap/robots XML+txt rendering
├── document.ts        the façade: one call → one render-ready SeoDocument
└── validate.ts        health checks, duplicate + redirect analysis
```

It is a **pure** package on purpose. The same functions run inside a NestJS
request, a CLI backfill, a Next.js server component, and a Jest test. That is
what makes "one source of truth" real rather than aspirational — the API and
the storefront cannot drift, because they call the same function.

Consumers:

| Consumer | Uses it for |
|---|---|
| `apps/api/src/modules/seo/` | slug lifecycle, URL resolution, sitemap feeds, health |
| `apps/buyer-marketplace/lib/seo.ts` | `Part` → engine input, `SeoDocument` → Next `Metadata` |
| `apps/buyer-marketplace/app/**` | page rendering |

---

## 2. The one function pages call

```ts
const seo = buildPartSeoDocument(part);   // or buildTaxonomySeoDocument(node)
```

`SeoDocument` carries everything a page needs: `canonical`, `title`, `h1`,
`description`, `robots`, `breadcrumbs`, `images` (with ALT), `openGraph`,
`twitter`, `structuredData`, `internalLinks`, `sitemapEligible`, `lastModified`.

A page component cannot forget a canonical or a robots directive, because it
does not assemble them.

---

## 3. URL architecture

| Entity | URL |
|---|---|
| Product | `/parts/<slug>` |
| Category | `/parts/category/<slug>` (`/page/N`) |
| Vehicle system | `/parts/system/<slug>` (`/page/N`) |
| Brand | `/brands/<slug>` (`/page/N`) |
| Vehicle make | `/vehicles/<make>` |
| Make + model | `/vehicles/<make>/<model>` |
| Make + model + year | `/vehicles/<make>/<model>/<year>` |
| Search (tool, `noindex`) | `/search?…` |

All served under the `/buyer` basePath. Canonicals always carry it — one
without it 302s and splits signals across two URLs.

`absoluteUrl()` is the only thing that emits an absolute URL. It normalises
trailing slash (matching `trailingSlash: true`, but *not* on `.xml`/`.txt`
paths, which Next excludes), strips tracking parameters, and sorts query keys
so `?a=1&b=2` and `?b=2&a=1` cannot advertise two URLs for one page.

### The legacy URL

`/part/<uuid>` was the product URL before this work and much of it is indexed.
It is **kept permanently** as a 301 to `/parts/<slug>`. Deleting it would 404
the entire indexed catalog.

---

## 4. Slugs

Built from the strongest fields available, in descending keyword value:

```
brand → vehicle (only if the part fits exactly one) → part name → part number
```

- Marketing filler ("Genuine", "OEM", "NEW", "Free Shipping") is stripped.
- Unicode is transliterated (`Größe` → `grosse`, `Citroën` → `citroen`).
- The **part number is never truncated away** — the length budget is applied to
  the descriptive portion, because an exact part number is the highest-intent
  token in the URL.
- Fitment is deliberately *not* used, because it arrives asynchronously after
  import; a slug that depended on it would differ based on whether enrichment
  had run yet.

**Two invariants:**

1. **Assigned once, then frozen.** `ensureSlug` no-ops for a part that already
   has one. Editing a title does not move a ranked URL.
2. **Uniqueness is deterministic, not sequential.** A collision appends a stable
   FNV-1a hash of the part id, not a counter — so concurrent importers compute
   the same slug and re-running the backfill is idempotent.

### Non-brands in the `brand` column

Roughly 7% of the catalog puts a *part-source label* in `CanonicalPart.brand`
rather than a manufacturer — "Genuine OEM" on ~14,860 listings and "ORIGINAL"
on ~5,042. Taken at face value that produced slugs like
`genuine-oem-2019-2023-bmw-x6-front-bumper-51118069942`, and would have minted
an indexable `/brands/genuine-oem` landing page clearing the inventory
threshold many times over while meaning nothing to a buyer.

`isMeaningfulBrand()` / `meaningfulBrand()` in `text.ts` gate every place a
brand becomes user- or URL-visible: slugs, titles, H1s, breadcrumbs, `Brand`
JSON-LD, brand taxonomy nodes, internal links, and the PDP spec table. The raw
value is still used to strip the label out of listing *titles*, which is
desirable. No condition information is lost — that lives in `partSource`,
`qualityTier`, and the condition badge.

Extend `NON_BRAND_LABELS` if new supplier feeds introduce further labels; a
quick `select brand, count(*) ... group by brand order by 2 desc` is the check.

### Changing a slug

`regenerateSlug` is the only supported way. It writes the outgoing slug to
`CanonicalPartSlug` before replacing it. Because history rows point at the
**part**, not at the replacing slug, every historical URL still resolves in
**one hop** — chains are impossible by construction, not by cleanup.

---

## 5. How it becomes automatic

This is the load-bearing design decision.

Slug assignment hangs off **`SearchIndexerService.indexPart`**, not off the
write paths. Every path that creates or changes a part — listing form, CSV
import, eBay sync, ERP push, bulk SQL insert plus a `SearchOutbox` row —
already flows through the outbox into the indexer. So:

```
any write path → SearchOutbox → SearchIndexerService.indexPart
                                    ├── ensureSlug()      ← SEO lifecycle
                                    └── index document
```

A part cannot become buyer-visible without a canonical URL, and **a future
import path inherits this for free** without knowing SEO exists. Hooking the
five known write paths individually would have missed the sixth.

Everything else derives at render time from the part's own data, so no other
lifecycle hook is needed: change the category and the breadcrumbs, taxonomy
links, and sitemap membership all move with it.

---

## 6. Index / noindex decision engine

No page decides its own robots directive. `decidePartIndexability` returns the
decision **and the reasons**, which is what makes the health report actionable.

A listing is indexable when it is live, has a purchasable offer, has an image,
has identity (part number, brand, or category), has a title, and carries enough
unique content. Anything else gets **`noindex, follow`** — `follow`, not `none`,
because a suppressed page must still pass crawl equity to the listings it links
to, or those listings become orphans.

**Out of stock does not change the URL or the index status.** It sets
`availability: OutOfStock` in the schema. Removing a ranked page because stock
ran out throws away the ranking. A permanently gone part 404s; it is never
redirected to the homepage (that is a soft 404).

`SEO_INDEXING_ENABLED=0` (the default outside production) blocks indexing
site-wide and **cannot be overridden** by an admin force-index. That single
switch is what keeps staging out of the index.

---

## 7. Guarding against programmatic-SEO explosion

Thresholds scale with how many URLs a pattern can generate:

| Page type | Minimum indexable listings | Env var |
|---|---|---|
| Category / system / brand / make | 8 | `SEO_MIN_TAXONOMY_PRODUCTS` |
| Make + model | 12 | `SEO_MIN_VEHICLE_MODEL_PRODUCTS` |
| Make + model + year | 25 | `SEO_MIN_VEHICLE_YEAR_PRODUCTS` |

Below threshold, a page **still renders and is still crawlable** — it just
carries `noindex, follow` and is excluded from sitemaps. Pagination beyond
page 1 is likewise crawlable but never indexed. A taxonomy node that returns
zero listings 404s rather than publishing an empty grid (a soft 404 and a thin
page at once).

### Faceted navigation

Users filter freely; crawlers do not. Exactly **one** facet with enough depth
is a real landing page, and it is expressed as a taxonomy URL. Everything else
— two or more facets, price ranges, non-canonical sorts, page-size variants,
free text, vehicle-config lookups, deep pages — is `noindex, follow` and
canonicalises back to the page that owns the term.

`/search` is **always** `noindex, follow`. It is a tool; the taxonomy pages are
the indexable equivalents. Indexing both would put two of our own pages in
front of the same query.

---

## 8. Structured data

Generated by `schema.ts`, every property conditional on its source field, and
`omitEmpty` applied so a missing attribute disappears rather than serialising
as `null`.

- `Product` — name, description, image, `sku` (our id) + `mpn` (the
  manufacturer's; conflating them makes two sellers' listings look like one
  SKU), brand, category, condition, alternate identifiers, `additionalProperty`
  from real catalog specifics, and `isAccessoryOrSparePartFor` vehicles.
- `Offer` / `AggregateOffer` — real prices, currency, availability, condition,
  seller. Shipping only when the seller publishes a rate.
- `BreadcrumbList` — from the same array that renders the visible trail, which
  is how the "markup must match the page" requirement is guaranteed rather than
  hoped for.
- `CollectionPage` + `ItemList` on taxonomy pages.
- `Organization` + `WebSite` once in the root layout, referenced by `@id`.

**There is no `aggregateRating` or `Review` anywhere.** The platform does not
collect reviews, so emitting them would be fabricated markup and a
manual-action risk. A test asserts their absence.

---

## 9. Images

- ALT is derived from the same structured attributes as the title. The primary
  image carries the full descriptive phrase; secondary images are numbered
  ("… — view 2 of 5") — repeating one string across eight `<img>` tags reads as
  keyword stuffing and tells a screen-reader user nothing.
- A curated `ProductMedia.altText` always wins (the per-image override).
- Ordering respects `isPrimary`/`sortOrder`, because index 0 is the LCP element
  *and* the social image.
- `imageLoading(0)` is eager + `fetchPriority: high`; everything else is lazy.
  Expressed in the engine so a new gallery cannot regress LCP.
- **Social images skip SVG.** This catalog hoists a generated infographic SVG to
  the front of `imageUrls` for high-value parts, and no social platform renders
  SVG for `og:image` — so `socialImage()` picks the first *raster* image.

---

## 10. Internal linking

A new listing is never an orphan. It links up into its category, system, brand,
make, and model (all real, crawlable landing pages), plus a search link for
other listings of the same part number. Taxonomy pages link back down into
listings and across to indexable siblings.

Related products are **attribute-scored, never random**: shared part number
(50) > same category (20) > same vehicle model (15) > same system (8) / same
make (8) > same brand (5). A zero-scoring candidate is dropped, and the list is
**never padded** to fill the grid — arbitrary "related" links are a
manipulative internal link under Google's spam policy and useless to a buyer.

---

## 11. Sitemaps and robots

```
/sitemap.xml                    ← sitemap index
├── /sitemaps/static.xml
├── /sitemaps/parts-1.xml …     ← 5 000 URLs each (SEO_SITEMAP_PAGE_SIZE)
├── /sitemaps/categories.xml
├── /sitemaps/brands.xml
└── /sitemaps/vehicles.xml
```

Only **canonical, indexable, 200-returning** URLs are included; eligibility is
filtered at source. `lastmod` is the entity's real `updatedAt` — stamping "now"
on every URL teaches Google that lastmod is meaningless.

Chunk N is addressable by number without a cursor: one windowed SQL pass
computes every chunk boundary and caches them, so each chunk fetch is a single
bounded keyset read. (Walking the keyset to chunk N would be 200 queries for
the last chunk of a million-row catalog; `OFFSET` would re-scan the prefix.)

`robots.txt` is a runtime route — a build-time evaluation previously baked
`localhost:7070` into production. It disallows private paths and crawl traps
but **explicitly allows `/_next/static/` and `/_next/image`**; blocking those
stops Google rendering the page at all.

---

## 11b. HTTP status correctness (Next 16 gotcha)

Two Next 16.2 behaviours bite this app specifically, both verified against a
production **standalone** build (`next start` does not reproduce them — it
refuses to run with `output: "standalone"`):

1. **`redirect()` / `permanentRedirect()` from a Server Component do not emit
   an HTTP redirect.** They return `200` with a client-side meta-refresh, which
   passes little link equity and leaves two URLs both answering `200`. The
   legacy `/part/<uuid>` → `/parts/<slug>` migration therefore lives in
   `proxy.ts` (Next 16's renamed `middleware.ts`), which runs before rendering
   and always emits a true `301`.

2. **A route-level `loading.tsx` makes `notFound()` return `200`.** It creates a
   Suspense boundary, so the shell is flushed before the status can be set —
   every unknown product URL became a soft 404 marked `index, follow`. The app
   had a *root* `app/loading.tsx` (a homepage-shaped skeleton rendered on every
   route), so this affected the whole site.

Both `loading.tsx` files were removed. Streaming is preserved where it actually
helps: the PDP's related-products lookup — an extra API call with no bearing on
the status — now renders inside `<Suspense>` via `RelatedPartsSection`, which
also takes it off the critical path for TTFB. Taxonomy links stay in the initial
HTML, since those are what keep a listing from being an orphan.

**Rule of thumb:** any route whose status depends on data (`notFound()`, a
redirect) must not have a `loading.tsx` above it, and must decide the status
before its first `await` inside a Suspense boundary.

## 12. Admin overrides

Optional, never required. Stored in `CanonicalPart.seo` (JSON, so a new
overridable field needs no migration):

```
title · description · h1 · slug · canonicalUrl · robots · ogImageUrl · breadcrumbLabel
```

Hierarchy is always **manual override → generated value → safe fallback**.

A `slug` override is sanitised and uniqueness-checked but **not applied on
save** — moving a live URL is a separate, explicit `regenerate-slug` call, so an
accidental save cannot break inbound links.

---

## 13. Observability

`GET /api/seo/health` returns catalog counters (missing slug, missing image, no
active offer, retired slugs, overrides) plus a sampled scan: per-listing status
(`healthy` / `warning` / `critical`), a ranked issue histogram, catalog-level
duplicate detection, and the worst offenders as a worklist.

`GET /api/seo/parts/:id` returns the full generated document + validation for
one listing — the debugging view.

The same `validatePartSeo` runs in the test suite against fixtures and in
production against live rows, so a rule that holds in tests is verifiable in
production.

---

## 14. Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /seo/resolve/:idOrSlug` | slug / retired slug / legacy UUID → part + redirect instruction |
| `GET /seo/sitemap/summary` | indexable count + chunk count |
| `GET /seo/sitemap/parts?page=N` | one sitemap chunk |
| `GET /seo/taxonomy` | taxonomy nodes + counts + eligibility |
| `GET /seo/taxonomy/resolve` | URL slug → catalog value |
| `GET /seo/health` | health report |
| `GET /seo/parts/:id` | document + validation for one part |
| `POST /seo/parts/:id/overrides` | write admin overrides |
| `POST /seo/parts/:id/regenerate-slug` | move a URL, retiring the old slug |
| `POST /seo/cache/invalidate` | drop cached aggregates after a bulk import |
| `GET /seo/config` | echo resolved config (verify env in a container) |

---

## 15. How future entities inherit this

**A new listing** (any entry path) — indexed → slug assigned → taxonomy derived
from its own fields → metadata, schema, breadcrumbs, ALT, internal links
generated at render → indexability decided → enters the sitemap. No developer
action.

**A new category / brand** — appears in the `groupBy` aggregation as soon as a
listing carries it. Once it passes the threshold it becomes an indexable
landing page with a sitemap entry. No route, no config.

**A new vehicle make/model** — same, via the fitment graph.

**A new taxonomy dimension** (e.g. engine code) — add the kind to
`SeoTaxonomyKind`, a path builder in `url.ts`, a threshold in `config.ts`, an
aggregation in `SeoCatalogService`, and a four-line route file that calls
`renderTaxonomy`. Metadata, canonical, breadcrumbs, schema, pagination, and
internal links come with it.

**A new frontend app** — `import { buildPartSeoDocument } from
'@repo/catalog-contracts'`.

---

## 16. Rollout

Order matters — the storefront calls `/seo/resolve`.

1. `npx prisma migrate deploy` — adds `slug`, `slugAssignedAt`, `seo`,
   `CanonicalPartSlug`, and the paging indexes. Non-blocking: `slug` is
   nullable and a partially-backfilled catalog is valid.
2. Deploy the **API** (adds `/seo/*`).
3. Deploy the **buyer app**.
4. Backfill, as a standalone container (a `docker exec` job dies when the
   container is recreated):
   ```
   docker run --rm --network <app-net> --env-file .env <api-image> \
     node dist/src/seo-backfill.cli.js --batch 2000
   ```
5. Submit `/buyer/sitemap.xml` in Search Console.

The buyer app **degrades safely if it ships first**: when `/seo/resolve` is
missing or the API is unhealthy, a UUID segment renders directly with no
redirect, exactly as the old route did. So step 3 before step 2 costs canonical
slugs temporarily, not a 404'd catalog. Before the backfill completes, parts
without a slug keep the legacy canonical and are excluded from sitemaps — they
are never given a URL that does not exist.

Config: `SITE_URL`, `SEO_INDEXING_ENABLED` (must be `1` in production, unset or
`0` everywhere else), plus the optional limit/threshold overrides in
`config.ts`.
