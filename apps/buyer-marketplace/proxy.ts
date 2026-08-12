import { NextResponse, type NextRequest } from "next/server";

/**
 * Legacy product-URL redirects.
 *
 * Every product URL this site published before the slug migration has the shape
 * `/part/<uuid>`, and the whole indexed catalog (~107k URLs) still points there.
 * Those must answer with a real HTTP 301 so the accumulated ranking transfers.
 *
 * This lives in the proxy (middleware) layer rather than in the route's Server Component because
 * `redirect()` / `permanentRedirect()` do **not** produce an HTTP redirect from
 * a page in Next 16.2 under this app's configuration — verified against a
 * production standalone build, they return `200` with a client-side
 * meta-refresh instead. A meta-refresh passes little to no link equity and
 * leaves two URLs both answering `200`, which is precisely the duplicate-content
 * outcome the migration exists to avoid. Middleware runs before rendering, so
 * `NextResponse.redirect` is always a true status code.
 *
 * Uses Next 16's `proxy.ts` convention; the older `middleware.ts` name is
 * deprecated and warns at build time.
 *
 * `/parts/<slug>` is deliberately *not* matched: resolving every canonical PDP
 * request here would put an API round-trip in front of the hot path. Retired
 * slugs (only produced by a deliberate `regenerate-slug` call, of which there
 * are currently none) are still handled inside that route.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? "http://localhost:3001";

interface ResolvedPart {
  id: string;
  slug: string | null;
  redirectToSlug?: string;
}

export default async function proxy(request: NextRequest) {
  // `nextUrl.pathname` excludes basePath, so this is `/part/<id>`.
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const id = segments[1];

  // Anything that is not a bare `/part/<uuid>` falls through to the route,
  // which 404s it. Redirecting unknown shapes would be a soft 404.
  if (segments[0] !== "part" || !id || !UUID_PATTERN.test(id)) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/seo/resolve/${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    // A genuine miss (404) falls through so the route renders a real 404.
    // An unhealthy API also falls through, where the route's own fallback
    // renders the legacy page rather than erroring.
    if (!res.ok) return NextResponse.next();

    const resolved = (await res.json()) as ResolvedPart;
    const slug = resolved.redirectToSlug ?? resolved.slug;
    // Not yet backfilled: render the legacy page rather than redirect to a
    // URL that does not exist.
    if (!slug) return NextResponse.next();

    const target = request.nextUrl.clone();
    // Trailing slash to match `trailingSlash: true`, so the 301 points at the
    // final URL instead of at another redirect.
    target.pathname = `/parts/${slug}/`;
    target.search = request.nextUrl.search;

    return NextResponse.redirect(target, 301);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Scoped tightly: this must not add latency to canonical PDPs, listing
  // pages, or static assets. `/part/:path*` does not match `/parts/...`.
  matcher: ["/part/:path*"],
};
