/**
 * Sitemap XML generation.
 *
 * Written as string builders rather than using Next's `MetadataRoute.Sitemap`
 * because that helper cannot express a sitemap *index*, and an index is
 * mandatory at this catalog's size: the protocol caps a single file at 50 000
 * URLs / 50 MB, and a one-file sitemap would also have to be regenerated in
 * full whenever any listing changed.
 *
 * Chunking is by stable page number so `parts-3.xml` keeps addressing roughly
 * the same slice of the catalog between crawls, which lets Google's
 * incremental fetching actually work.
 */

import { seoConfig } from './config';
import { text } from './text';

export interface SitemapEntry {
  url: string;
  lastModified?: string | Date | null;
  changeFrequency?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  priority?: number;
}

/** XML-escape. Ampersands in filter URLs are the common failure here. */
export function escapeXml(value: string): string {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(value: SitemapEntry['lastModified']): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A `<urlset>` document. */
export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .filter((entry) => text(entry.url))
    .map((entry) => {
      const lastmod = isoDate(entry.lastModified);
      return [
        '  <url>',
        `    <loc>${escapeXml(entry.url)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
        entry.changeFrequency
          ? `    <changefreq>${entry.changeFrequency}</changefreq>`
          : '',
        entry.priority !== undefined
          ? `    <priority>${entry.priority.toFixed(1)}</priority>`
          : '',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export interface SitemapIndexEntry {
  url: string;
  lastModified?: string | Date | null;
}

/** A `<sitemapindex>` document. */
export function renderSitemapIndex(entries: SitemapIndexEntry[]): string {
  const items = entries
    .filter((entry) => text(entry.url))
    .map((entry) => {
      const lastmod = isoDate(entry.lastModified);
      return [
        '  <sitemap>',
        `    <loc>${escapeXml(entry.url)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
        '  </sitemap>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}

/** How many part sitemap files a catalog of `total` listings needs. */
export function sitemapPageCount(total: number): number {
  const { limits } = seoConfig();
  return Math.max(1, Math.ceil(total / limits.sitemapPageSize));
}

/**
 * robots.txt.
 *
 * Environment-aware by construction: a deployment where indexing is disabled
 * emits a blanket disallow, so a staging container can never be indexed
 * because someone forgot a per-page directive.
 *
 * Note what is *not* disallowed: `/_next/` and `/img-proxy/`. Blocking those
 * would stop Google rendering the page at all, which is the classic
 * self-inflicted robots.txt wound.
 */
export function renderRobotsTxt(sitemapUrl: string): string {
  const { indexingEnabled, privatePathPrefixes, basePath } = seoConfig();

  if (!indexingEnabled) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }

  const disallow = privatePathPrefixes.map(
    (prefix) => `Disallow: ${basePath}${prefix}`,
  );

  return [
    'User-agent: *',
    'Allow: /',
    ...disallow,
    // Faceted and sorted views are crawlable (they carry noindex,follow so
    // their links are still followed) but not worth crawl budget at scale.
    `Disallow: ${basePath}/search?*sort=price_asc*`,
    `Disallow: ${basePath}/search?*sort=price_desc*`,
    `Disallow: ${basePath}/search?*pageSize=*`,
    `Disallow: ${basePath}/*?*utm_`,
    '',
    // Explicitly re-allow the render-critical assets that a broad Disallow
    // could otherwise catch.
    `Allow: ${basePath}/_next/static/`,
    `Allow: ${basePath}/_next/image`,
    '',
    `Sitemap: ${sitemapUrl}`,
    '',
  ].join('\n');
}
