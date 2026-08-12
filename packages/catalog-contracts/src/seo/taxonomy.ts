/**
 * Taxonomy derivation.
 *
 * A listing does not declare which taxonomy pages it belongs to; the taxonomy
 * is *derived* from its own attributes. That is what makes the system
 * automatic: an importer that writes `brand`, `category`, and a fitment row
 * has, by that act alone, filed the listing under a brand page, a category
 * page, a system page, a make page, and a model page — with no taxonomy
 * bookkeeping of its own.
 *
 * The same derivation runs in the API (to count listings per node and decide
 * which nodes deserve pages) and in the buyer app (to render breadcrumbs and
 * internal links), so the two can never disagree about where a part lives.
 */

import { meaningfulBrand, titleCase, text, uniqueStrings } from './text';
import type { SeoPartInput, SeoTaxonomyInput, SeoTaxonomyKind } from './types';

export interface TaxonomyNodeRef {
  kind: SeoTaxonomyKind;
  name: string;
  year?: number;
  parents?: Array<{ kind: SeoTaxonomyKind; name: string }>;
}

/**
 * Every taxonomy node a part belongs to, outermost first.
 *
 * Vehicle nodes are only emitted for makes/models the part actually lists a
 * fitment for. Year nodes are emitted per fitment year range, but capped:
 * a part fitting a 20-year range should not single-handedly create 20 year
 * pages, and the eligibility thresholds would reject them anyway.
 */
export function partTaxonomy(part: SeoPartInput): TaxonomyNodeRef[] {
  const nodes: TaxonomyNodeRef[] = [];

  const categoryGroup = text(part.categoryGroup);
  if (categoryGroup) nodes.push({ kind: 'categoryGroup', name: categoryGroup });

  const category = text(part.category);
  if (category) {
    nodes.push({
      kind: 'category',
      name: category,
      ...(categoryGroup
        ? { parents: [{ kind: 'categoryGroup' as const, name: categoryGroup }] }
        : {}),
    });
  }

  // A part-source label in the brand column must never become a brand page:
  // "Genuine OEM" alone would clear the inventory threshold many times over
  // and produce an indexed landing page that means nothing.
  const brand = meaningfulBrand(part.brand) || meaningfulBrand(part.manufacturer);
  if (brand) nodes.push({ kind: 'brand', name: brand });

  const vehicles = part.compatibleVehicles || [];
  const makes = uniqueStrings(vehicles.map((vehicle) => vehicle?.make));
  for (const make of makes) {
    nodes.push({ kind: 'make', name: make });

    const models = uniqueStrings(
      vehicles
        .filter((vehicle) => text(vehicle?.make).toLowerCase() === make.toLowerCase())
        .map((vehicle) => vehicle?.model),
    );
    for (const model of models) {
      nodes.push({
        kind: 'model',
        name: model,
        parents: [{ kind: 'make', name: make }],
      });
    }
  }

  return nodes;
}

/** Distinct model years a part is documented to fit, ascending. */
export function partFitmentYears(part: SeoPartInput, cap = 40): number[] {
  const years = new Set<number>();
  for (const vehicle of part.compatibleVehicles || []) {
    const start = Number(vehicle?.startYear);
    const end = Number(vehicle?.endYear ?? vehicle?.startYear);
    if (!Number.isFinite(start) || start < 1900 || start > 2100) continue;
    const last = Number.isFinite(end) && end >= start ? Math.min(end, 2100) : start;
    for (let year = start; year <= last && years.size < cap; year++) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Whether a part carries enough vehicle information to be filed under a
 * specific vehicle at all. Used to keep vehicle pages free of universal parts,
 * which would make every vehicle page look identical.
 */
export function hasVehicleTaxonomy(part: SeoPartInput): boolean {
  return partTaxonomy(part).some((node) => node.kind === 'make');
}

/** Display label for a node, e.g. `model` → "Corolla", `modelYear` → "2019". */
export function nodeLabel(node: TaxonomyNodeRef | SeoTaxonomyInput): string {
  if (node.kind === 'modelYear') return text(node.year) || titleCase(node.name);
  return titleCase(node.name);
}

/**
 * Turn a bare node reference into a full `SeoTaxonomyInput`. The count is
 * supplied by the caller because only the data layer can know it.
 */
export function toTaxonomyInput(
  ref: TaxonomyNodeRef,
  productCount: number,
  extra: Partial<SeoTaxonomyInput> = {},
): SeoTaxonomyInput {
  return {
    kind: ref.kind,
    name: ref.name,
    productCount,
    ...(ref.parents ? { parents: ref.parents } : {}),
    ...(ref.year !== undefined ? { year: ref.year } : {}),
    ...extra,
  };
}

/**
 * Stable identity key for a taxonomy node, used to aggregate counts and to
 * de-duplicate nodes derived from many parts.
 */
export function taxonomyKey(ref: TaxonomyNodeRef): string {
  const parents = (ref.parents || [])
    .map((parent) => `${parent.kind}:${parent.name.toLowerCase()}`)
    .join('>');
  return [
    ref.kind,
    parents,
    ref.name.toLowerCase(),
    ref.year ?? '',
  ].join('|');
}

/**
 * Aggregate taxonomy counts across a set of parts. This is what a backfill or
 * a sitemap job runs to discover which nodes exist and how much inventory
 * each has, without any manually maintained taxonomy table.
 */
export function aggregateTaxonomy(
  parts: SeoPartInput[],
): Map<string, { ref: TaxonomyNodeRef; productCount: number }> {
  const counts = new Map<string, { ref: TaxonomyNodeRef; productCount: number }>();
  for (const part of parts) {
    for (const ref of partTaxonomy(part)) {
      const key = taxonomyKey(ref);
      const existing = counts.get(key);
      if (existing) existing.productCount += 1;
      else counts.set(key, { ref, productCount: 1 });
    }
  }
  return counts;
}
