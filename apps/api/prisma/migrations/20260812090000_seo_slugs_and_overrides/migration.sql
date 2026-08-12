-- Programmatic SEO: canonical slugs, admin overrides, and slug history.
--
-- `slug` is nullable so this migration is non-blocking on an existing catalog:
-- rows are backfilled afterwards by `npm run seo:backfill`, which assigns slugs
-- in batches. The UNIQUE index tolerates unlimited NULLs in Postgres, so
-- partially-backfilled state is valid.

ALTER TABLE "CanonicalPart" ADD COLUMN "slug" TEXT;
ALTER TABLE "CanonicalPart" ADD COLUMN "slugAssignedAt" TIMESTAMP(3);
ALTER TABLE "CanonicalPart" ADD COLUMN "seo" JSONB;

CREATE UNIQUE INDEX "CanonicalPart_slug_key" ON "CanonicalPart"("slug");

-- Sitemap paging orders by updatedAt; taxonomy counts group by category/brand.
-- Without these, both degrade to sequential scans as the catalog grows.
CREATE INDEX "CanonicalPart_updatedAt_idx" ON "CanonicalPart"("updatedAt");
CREATE INDEX "CanonicalPart_category_idx" ON "CanonicalPart"("category");
CREATE INDEX "CanonicalPart_brand_idx" ON "CanonicalPart"("brand");

-- Retired slugs. One row per URL we have ever published for a part, so an old
-- URL can 301 straight to the part's current slug in a single hop.
CREATE TABLE "CanonicalPartSlug" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalPartSlug_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalPartSlug_slug_key" ON "CanonicalPartSlug"("slug");
CREATE INDEX "CanonicalPartSlug_partId_idx" ON "CanonicalPartSlug"("partId");

ALTER TABLE "CanonicalPartSlug"
    ADD CONSTRAINT "CanonicalPartSlug_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "CanonicalPart"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
