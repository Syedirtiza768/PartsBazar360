/**
 * Breadcrumb generation.
 *
 * Breadcrumbs come from the derived taxonomy, never from per-page
 * configuration. A part's trail is the most specific path that its own data
 * supports, so adding a category to a listing deepens its breadcrumb trail
 * automatically — and a listing that has only a brand still gets a coherent,
 * two-level trail rather than a broken one.
 *
 * The same array feeds both the visible `<nav>` and the `BreadcrumbList`
 * JSON-LD, which is the only way to guarantee Google's requirement that the
 * markup match what the user sees.
 */

import { seoConfig } from './config';
import { partNameCore, taxonomyLabel } from './metadata';
import { dominantVehicle } from './slug';
import { clip, meaningfulBrand, text, titleCase } from './text';
import {
  absoluteUrl,
  brandPath,
  categoryGroupPath,
  categoryPath,
  makePath,
  modelPath,
  partPath,
  taxonomyPath,
} from './url';
import type { SeoBreadcrumb, SeoPartInput, SeoTaxonomyInput } from './types';

/** Crumb labels are short by design — a full listing title breaks the trail. */
const CRUMB_LABEL_MAX = 48;

function crumb(name: string, path: string): SeoBreadcrumb {
  return { name: clip(name, CRUMB_LABEL_MAX), path, url: absoluteUrl(path) };
}

/**
 * Breadcrumb trail for a product detail page.
 *
 * Order is Home → System → Category → Brand or Vehicle → Product. Brand and
 * vehicle are alternatives rather than both: a five-level trail with two
 * sibling facets reads as a filter list, not a hierarchy.
 */
export function partBreadcrumbs(part: SeoPartInput): SeoBreadcrumb[] {
  const trail: SeoBreadcrumb[] = [crumb('Home', '/')];

  const categoryGroup = text(part.categoryGroup);
  if (categoryGroup) {
    trail.push(crumb(titleCase(categoryGroup), categoryGroupPath(categoryGroup)));
  }

  const category = text(part.category);
  if (category) trail.push(crumb(titleCase(category), categoryPath(category)));

  const { make, model } = dominantVehicle(part);
  const brand = meaningfulBrand(part.brand) || meaningfulBrand(part.manufacturer);

  // Prefer the vehicle when the part fits exactly one — it is the stronger
  // navigational context for a buyer who arrived on a fitment query.
  if (make) {
    trail.push(crumb(titleCase(make), makePath(make)));
    if (model) trail.push(crumb(titleCase(model), modelPath(make, model)));
  } else if (brand) {
    trail.push(crumb(titleCase(brand), brandPath(brand)));
  }

  // Neither category nor brand nor vehicle: keep the trail two-deep rather
  // than jumping Home → Product, which reads as a broken hierarchy.
  if (trail.length === 1) trail.push(crumb('All parts', '/search'));

  // The leaf names the part itself, not the whole listing title — the trail
  // already carries brand/vehicle/category, so repeating them here would make
  // the last crumb longer than the rest of the trail combined.
  const leafLabel =
    text(part.seo?.breadcrumbLabel) ||
    titleCase(partNameCore(part)) ||
    text(part.title) ||
    'Part';

  const slug = text(part.slug);
  // A part without a slug yet has no canonical URL; point the leaf at the
  // trail's own parent rather than fabricating a URL that would 404.
  const leafPath = slug ? partPath(slug) : trail[trail.length - 1]!.path;
  trail.push(crumb(leafLabel, leafPath));

  return trail;
}

/** Breadcrumb trail for a taxonomy landing page. */
export function taxonomyBreadcrumbs(node: SeoTaxonomyInput): SeoBreadcrumb[] {
  const trail: SeoBreadcrumb[] = [crumb('Home', '/')];

  const parents = node.parents || [];
  for (let index = 0; index < parents.length; index++) {
    const parent = parents[index]!;
    // Rebuild each ancestor as a node so its own URL pattern is used, rather
    // than assuming a flat parent path.
    trail.push(
      crumb(
        titleCase(parent.name),
        taxonomyPath({
          kind: parent.kind,
          name: parent.name,
          productCount: 0,
          parents: parents.slice(0, index),
        }),
      ),
    );
  }

  // The leaf names only what this level adds. A year page whose trail already
  // reads Toyota > Corolla ends in "2019", not "2019 Toyota Corolla".
  const leafLabel =
    node.kind === 'modelYear'
      ? text(node.year) || titleCase(node.name)
      : titleCase(node.name) || taxonomyLabel(node);

  trail.push(crumb(leafLabel, taxonomyPath({ ...node, page: 1 })));

  // A paginated view is a distinct URL and must say so in its own trail.
  if ((node.page ?? 1) > 1) {
    trail.push(crumb(`Page ${node.page}`, taxonomyPath(node)));
  }

  return trail;
}

/**
 * `BreadcrumbList` JSON-LD. The final item deliberately keeps its `item` URL:
 * Google accepts a self-referential last crumb and it makes the markup
 * unambiguous about which URL the trail terminates at.
 */
export function breadcrumbJsonLd(
  breadcrumbs: SeoBreadcrumb[],
): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${breadcrumbs[breadcrumbs.length - 1]?.url ?? seoConfig().siteUrl}#breadcrumb`,
    itemListElement: breadcrumbs.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
}
