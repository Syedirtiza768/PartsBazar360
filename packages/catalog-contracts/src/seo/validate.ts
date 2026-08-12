/**
 * SEO validation and health scoring.
 *
 * This is the observability layer: it turns "is our SEO correct?" from a
 * question answered by opening pages one at a time into a query that runs over
 * the whole catalog. The same checks run in unit tests (against fixtures) and
 * in the API's health endpoint (against live rows), so a regression that would
 * degrade production SEO fails a test first.
 *
 * Severity is deliberately coarse. `critical` means the page is broken or
 * actively harmful if indexed; `warning` means it is indexable but leaving
 * value on the table; `info` is a note.
 */

import { seoConfig } from './config';
import { buildPartSeoDocument } from './document';
import { hasImage } from './image';
import { contentDepth } from './indexability';
import { isReservedSlug, isValidSlug } from './slug';
import { text } from './text';
import { normalizeInboundUrl } from './url';
import type { SeoDocument, SeoPartInput } from './types';

export type SeoIssueSeverity = 'critical' | 'warning' | 'info';

export interface SeoIssue {
  code: string;
  severity: SeoIssueSeverity;
  message: string;
}

export type SeoHealthStatus = 'healthy' | 'warning' | 'critical';

export interface SeoHealthReport {
  entityId: string;
  status: SeoHealthStatus;
  /** 0–100. Purely for sorting a worklist; the issues are the real output. */
  score: number;
  indexable: boolean;
  issues: SeoIssue[];
}

function issue(
  code: string,
  severity: SeoIssueSeverity,
  message: string,
): SeoIssue {
  return { code, severity, message };
}

/**
 * Validate a single part's SEO.
 *
 * Note the distinction between *"this page is noindex"* and *"this page is
 * broken"*. A listing that is correctly noindex because it has no image is
 * healthy-but-suppressed, not critical: the system did the right thing. What
 * is critical is a page that will be indexed while missing something a
 * crawler needs.
 */
export function validatePartSeo(
  part: SeoPartInput,
  document?: SeoDocument,
): SeoHealthReport {
  const { limits } = seoConfig();
  const doc = document || buildPartSeoDocument(part);
  const issues: SeoIssue[] = [];
  const indexable = doc.robots.index;

  // ---- structural integrity (broken regardless of index status) ----------
  const slug = text(part.slug);
  if (!slug) {
    issues.push(issue('slug.missing', 'critical', 'No slug — the part has no canonical URL'));
  } else if (!isValidSlug(slug)) {
    issues.push(
      issue('slug.invalid', 'critical', `Slug "${slug}" is not a valid URL segment`),
    );
  } else if (isReservedSlug(slug)) {
    issues.push(
      issue('slug.reserved', 'critical', `Slug "${slug}" collides with a route`),
    );
  }

  if (!normalizeInboundUrl(doc.canonical)) {
    issues.push(issue('canonical.invalid', 'critical', 'Canonical URL is not a valid absolute URL'));
  }

  if (!text(doc.title)) {
    issues.push(issue('title.missing', 'critical', 'No title'));
  }
  if (!text(doc.description)) {
    issues.push(issue('description.missing', 'critical', 'No meta description'));
  }
  if (!text(doc.h1)) {
    issues.push(issue('h1.missing', 'critical', 'No H1'));
  }
  if (doc.breadcrumbs.length < 2) {
    issues.push(issue('breadcrumbs.shallow', 'warning', 'Breadcrumb trail has no intermediate level'));
  }

  // Placeholder text leaking into rendered metadata is always a bug.
  for (const [field, value] of [
    ['title', doc.title],
    ['description', doc.description],
    ['h1', doc.h1],
  ] as const) {
    if (/\b(undefined|null|NaN|\[object Object\])\b/i.test(value)) {
      issues.push(
        issue(`${field}.placeholder`, 'critical', `${field} contains a placeholder value`),
      );
    }
    // "Toyota | | Camera" — an empty slot between separators.
    if (/(\|\s*\|)|(\s-\s-\s)|(,\s*,)/.test(value)) {
      issues.push(
        issue(`${field}.emptySlot`, 'critical', `${field} has an empty template slot`),
      );
    }
  }

  // ---- quality (only meaningful for pages that will be indexed) ---------
  if (indexable) {
    if (doc.title.length > limits.title) {
      issues.push(
        issue('title.long', 'warning', `Title is ${doc.title.length} chars (limit ${limits.title})`),
      );
    }
    if (doc.description.length > limits.description) {
      issues.push(
        issue(
          'description.long',
          'warning',
          `Description is ${doc.description.length} chars (limit ${limits.description})`,
        ),
      );
    }
    if (doc.description.length < 70) {
      issues.push(issue('description.short', 'warning', 'Description is unusually short'));
    }
    if (!hasImage(part)) {
      issues.push(issue('image.missing', 'critical', 'Indexable page with no image'));
    }
    if (!doc.internalLinks.length) {
      issues.push(issue('links.orphan', 'critical', 'No internal links — page is an orphan'));
    }
    if (!doc.sitemapEligible) {
      issues.push(
        issue('sitemap.excluded', 'warning', 'Indexable but excluded from the sitemap'),
      );
    }
    if (contentDepth(part) < seoConfig().thresholds.minDescriptionChars * 2) {
      issues.push(issue('content.thin', 'warning', 'Little unique content on the page'));
    }
  }

  // ALT text must exist on every image, and must not simply repeat.
  const alts = doc.images.map((image) => text(image.alt));
  if (alts.some((alt) => !alt)) {
    issues.push(issue('alt.missing', 'critical', 'An image has no ALT text'));
  }
  if (alts.length > 1 && new Set(alts).size === 1) {
    issues.push(issue('alt.duplicate', 'warning', 'Every image shares identical ALT text'));
  }

  // Structured data must at least contain a Product node with an offer.
  const nodes = (doc.structuredData['@graph'] as Array<Record<string, unknown>>) || [];
  const product = nodes.find((node) => node['@type'] === 'Product');
  if (!product) {
    issues.push(issue('schema.noProduct', 'critical', 'No Product JSON-LD'));
  } else if (!product['offers']) {
    issues.push(issue('schema.noOffers', 'warning', 'Product JSON-LD has no offers node'));
  }
  if (!nodes.some((node) => node['@type'] === 'BreadcrumbList')) {
    issues.push(issue('schema.noBreadcrumb', 'warning', 'No BreadcrumbList JSON-LD'));
  }

  return summarize(part.id, issues, indexable);
}

function summarize(
  entityId: string,
  issues: SeoIssue[],
  indexable: boolean,
): SeoHealthReport {
  const critical = issues.filter((entry) => entry.severity === 'critical').length;
  const warnings = issues.filter((entry) => entry.severity === 'warning').length;
  const score = Math.max(0, 100 - critical * 25 - warnings * 6);
  const status: SeoHealthStatus =
    critical > 0 ? 'critical' : warnings > 0 ? 'warning' : 'healthy';
  return { entityId, status, score, indexable, issues };
}

/**
 * Catalog-level checks that no single part can detect on its own: duplicate
 * slugs and duplicate canonicals. Run by the health endpoint over a page of
 * rows at a time.
 */
export function findDuplicates(
  entries: Array<{ id: string; slug?: string | null; canonical?: string | null }>,
): SeoIssue[] {
  const issues: SeoIssue[] = [];

  const bySlug = new Map<string, string[]>();
  const byCanonical = new Map<string, string[]>();

  for (const entry of entries) {
    const slug = text(entry.slug).toLowerCase();
    if (slug) bySlug.set(slug, [...(bySlug.get(slug) || []), entry.id]);
    const canonical = normalizeInboundUrl(text(entry.canonical));
    if (canonical) {
      byCanonical.set(canonical, [...(byCanonical.get(canonical) || []), entry.id]);
    }
  }

  for (const [slug, ids] of bySlug) {
    if (ids.length > 1) {
      issues.push(
        issue(
          'slug.duplicate',
          'critical',
          `Slug "${slug}" is used by ${ids.length} parts: ${ids.slice(0, 5).join(', ')}`,
        ),
      );
    }
  }
  for (const [canonical, ids] of byCanonical) {
    if (ids.length > 1) {
      issues.push(
        issue(
          'canonical.duplicate',
          'critical',
          `Canonical ${canonical} is claimed by ${ids.length} parts`,
        ),
      );
    }
  }

  return issues;
}

/**
 * Assert a redirect map contains no chains and no loops.
 *
 * `A → B → C` must be flattened to `A → C`, `B → C`. This returns the issues
 * *and* the flattened map, so a caller can both report and repair.
 */
export function analyzeRedirects(
  redirects: Map<string, string>,
): { issues: SeoIssue[]; flattened: Map<string, string> } {
  const issues: SeoIssue[] = [];
  const flattened = new Map<string, string>();

  for (const [from] of redirects) {
    const seen = new Set<string>([from]);
    let current = redirects.get(from)!;
    let hops = 0;

    while (redirects.has(current)) {
      if (seen.has(current)) {
        issues.push(
          issue('redirect.loop', 'critical', `Redirect loop starting at "${from}"`),
        );
        current = from;
        break;
      }
      seen.add(current);
      current = redirects.get(current)!;
      hops++;
      if (hops > 25) {
        issues.push(
          issue('redirect.runaway', 'critical', `Redirect from "${from}" exceeds 25 hops`),
        );
        break;
      }
    }

    if (hops > 0 && current !== from) {
      issues.push(
        issue(
          'redirect.chain',
          'warning',
          `Redirect "${from}" reaches "${current}" via ${hops} intermediate hop${hops === 1 ? '' : 's'}`,
        ),
      );
    }

    if (current !== from) flattened.set(from, current);
  }

  return { issues, flattened };
}

/** Roll a set of per-entity reports into one catalog summary. */
export function summarizeHealth(reports: SeoHealthReport[]): {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  indexable: number;
  topIssues: Array<{ code: string; count: number; severity: SeoIssueSeverity }>;
} {
  const counts = new Map<string, { count: number; severity: SeoIssueSeverity }>();
  for (const report of reports) {
    for (const entry of report.issues) {
      const existing = counts.get(entry.code);
      if (existing) existing.count += 1;
      else counts.set(entry.code, { count: 1, severity: entry.severity });
    }
  }

  return {
    total: reports.length,
    healthy: reports.filter((report) => report.status === 'healthy').length,
    warning: reports.filter((report) => report.status === 'warning').length,
    critical: reports.filter((report) => report.status === 'critical').length,
    indexable: reports.filter((report) => report.indexable).length,
    topIssues: [...counts.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };
}
