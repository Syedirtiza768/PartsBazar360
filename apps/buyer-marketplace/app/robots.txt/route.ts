import { absoluteUrl, renderRobotsTxt, seoConfig } from "@repo/catalog-contracts";

/**
 * robots.txt.
 *
 * Must be a runtime route, not a static one: Next can evaluate a metadata
 * route at build time, and when it does, `SITE_URL` is not yet set inside the
 * container — which previously baked `http://localhost:7070/buyer` into the
 * production sitemap directive.
 *
 * The body itself comes from the shared engine so the private-path list has
 * exactly one definition, shared with the indexability rules. Notably it does
 * *not* disallow `/_next/` or the image proxy: blocking those stops Google
 * rendering the page at all, which is the classic self-inflicted robots wound.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const body = renderRobotsTxt(absoluteUrl("/sitemap.xml"));

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Short cache: a mistake here is high-blast-radius, so it must be
      // correctable within minutes rather than hours.
      "Cache-Control": "public, max-age=0, s-maxage=300",
      // Surfaced so an operator can confirm which environment answered.
      "X-Robots-Environment": seoConfig().indexingEnabled ? "indexable" : "blocked",
    },
  });
}
