/**
 * SEO helpers shared by metadata, robots, sitemap, and JSON-LD.
 *
 * SITE_URL must resolve at request time. Next can statically evaluate
 * metadata routes at build time when env is unset, which previously baked
 * `http://localhost:7070/buyer` into production robots.txt.
 */

const PRODUCTION_SITE_URL = "https://partsbazar360.com/buyer";

/** Public storefront origin including `/buyer` basePath, no trailing slash. */
export function getSiteUrl(): string {
  // Bracket access + String() avoid some build-time const-folding of process.env.
  const fromEnv = String(process.env["SITE_URL"] || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return PRODUCTION_SITE_URL;
  return "http://localhost:7070/buyer";
}

/** Absolute URL for a path under the buyer basePath (path may start with `/`). */
export function absoluteUrl(path = "/"): string {
  const base = getSiteUrl();
  if (!path || path === "/") return `${base}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Prefer trailing slash to match next.config trailingSlash: true.
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${base}${withSlash}`;
}

export function searchCanonical(params: {
  category?: string;
  brand?: string;
  q?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.brand) qs.set("brand", params.brand);
  if (params.q) qs.set("q", params.q);
  const query = qs.toString();
  // Query URLs keep no trailing slash before `?` — Google treats both forms;
  // we match existing live canonicals for category/brand hubs.
  return query ? `${getSiteUrl()}/search?${query}` : absoluteUrl("/search");
}

export const NOINDEX_ROBOTS = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
} as const;

export const INDEX_ROBOTS = {
  index: true,
  follow: true,
} as const;
