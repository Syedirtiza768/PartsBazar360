import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { partPath } from "@repo/catalog-contracts";

/**
 * On-demand ISR / Data Cache invalidation for PDP tags.
 * Called by the Nest API after merchant offer edits (shared secret).
 *
 * POST /buyer/api/revalidate/
 * Headers: x-revalidate-secret: <REVALIDATE_SECRET>
 * Body: { tag?: string, partId?: string, path?: string }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "revalidate disabled" }, { status: 503 });
  }

  const provided = req.headers.get("x-revalidate-secret");
  if (!provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    tag?: string;
    partId?: string;
    slug?: string;
    path?: string;
    scope?: "part" | "taxonomy" | "sitemap";
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const tags: string[] = [];
  const paths: string[] = [];

  if (body.tag) tags.push(body.tag);
  if (body.path) paths.push(body.path);

  if (body.partId) {
    tags.push(`part:${body.partId}`);
    // The slug↔id resolution is cached separately from the part payload, so a
    // slug regeneration has to purge both or the old URL keeps rendering.
    tags.push(`seo:resolve:${body.partId}`);
    paths.push(`/part/${body.partId}`);
  }
  if (body.slug) {
    tags.push(`seo:resolve:${body.slug}`);
    paths.push(partPath(body.slug));
  }

  // Scoped invalidation, so a price change does not rebuild the whole site.
  // A part change purges that part; only an explicit taxonomy/sitemap scope
  // (a category rename, a bulk import) purges the aggregate caches, which are
  // expensive to rebuild and stale-tolerant by design.
  if (body.scope === "taxonomy" || body.scope === "sitemap") {
    tags.push("seo:taxonomy");
  }
  if (body.scope === "sitemap") {
    tags.push("seo:sitemap");
  }

  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
  for (const path of new Set(paths)) revalidatePath(path);

  return NextResponse.json({ ok: true, tags: [...new Set(tags)], paths: [...new Set(paths)] });
}
