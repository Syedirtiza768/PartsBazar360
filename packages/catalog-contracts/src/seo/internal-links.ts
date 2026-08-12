/**
 * Internal linking.
 *
 * The purpose is to guarantee that a newly published listing is never an
 * orphan: the moment it exists it links up into its taxonomy, and its
 * taxonomy pages link back down into it. Because the links are derived from
 * the same attributes the taxonomy is derived from, this happens without any
 * per-listing link configuration.
 *
 * Related-product selection is attribute-based, never random. A "related"
 * link that is actually arbitrary is a manipulative internal link under
 * Google's spam policy and is useless to a buyer besides, so this module only
 * ever proposes candidates it can justify by a shared attribute.
 */

import { titleCase, normalizeIdentifier, text, uniqueStrings } from './text';
import { partTaxonomy } from './taxonomy';
import {
  brandPath,
  categoryGroupPath,
  categoryPath,
  makePath,
  modelPath,
  partPath,
  searchPath,
} from './url';
import { dominantVehicle, primaryPartNumber } from './slug';
import type { SeoInternalLink, SeoPartInput } from './types';

/**
 * The "up and across" links a product page owes its taxonomy.
 *
 * Every one of these targets is a real, crawlable landing page (or the
 * search tool for identifier lookups), so a crawler that lands on a deep
 * product page can always climb back out into the catalog.
 */
export function partInternalLinks(part: SeoPartInput): SeoInternalLink[] {
  const links: SeoInternalLink[] = [];

  for (const node of partTaxonomy(part)) {
    switch (node.kind) {
      case 'categoryGroup':
        links.push({
          label: `${titleCase(node.name)} parts`,
          path: categoryGroupPath(node.name),
          relation: 'categoryGroup',
        });
        break;
      case 'category':
        links.push({
          label: `${titleCase(node.name)}`,
          path: categoryPath(node.name),
          relation: 'category',
        });
        break;
      case 'brand':
        links.push({
          label: `${titleCase(node.name)} parts`,
          path: brandPath(node.name),
          relation: 'brand',
        });
        break;
      case 'make':
        links.push({
          label: `${titleCase(node.name)} parts`,
          path: makePath(node.name),
          relation: 'make',
        });
        break;
      case 'model': {
        const make = text(node.parents?.find((parent) => parent.kind === 'make')?.name);
        links.push({
          label: `${titleCase(make)} ${titleCase(node.name)} parts`,
          path: modelPath(make, node.name),
          relation: 'model',
        });
        break;
      }
      default:
        break;
    }
  }

  // Identifier lookups go to search, not a landing page: one URL per part
  // number would be millions of near-empty pages. Search is `noindex,follow`,
  // so this is a crawl path for the parts it lists, not an indexable page.
  const number = primaryPartNumber(part);
  if (number) {
    links.push({
      label: `Other listings for ${number}`,
      path: searchPath({ q: number }),
      relation: 'partNumber',
    });
  }

  // De-duplicate by path — a part whose brand equals its make would otherwise
  // emit the same destination twice with different labels.
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.path)) return false;
    seen.add(link.path);
    return true;
  });
}

export interface RelatedCandidate {
  id: string;
  slug?: string | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  manufacturerPartNumber?: string | null;
  oeNumbers?: Array<string | null> | null;
  compatibleVehicles?: Array<{ make?: string | null; model?: string | null }> | null;
  imageUrls?: Array<string | null> | null;
}

export interface ScoredRelated {
  candidate: RelatedCandidate;
  score: number;
  /** Which attributes justified the link — surfaced in tests and diagnostics. */
  reasons: string[];
}

/**
 * Score how related a candidate is to a part.
 *
 * The weighting encodes what a buyer means by "related" on a parts site:
 * the same part number from a different seller is the strongest possible
 * relation, then the same category on the same vehicle, then either alone.
 * A candidate scoring zero is dropped rather than padded into the list.
 */
export function scoreRelated(
  part: SeoPartInput,
  candidate: RelatedCandidate,
): ScoredRelated {
  const reasons: string[] = [];
  let score = 0;

  if (candidate.id === part.id) return { candidate, score: 0, reasons };

  const partNumbers = new Set(
    uniqueStrings([
      primaryPartNumber(part),
      ...(part.oeNumbers || []),
    ]).map(normalizeIdentifier),
  );
  const candidateNumbers = uniqueStrings([
    candidate.manufacturerPartNumber,
    ...(candidate.oeNumbers || []),
  ]).map(normalizeIdentifier);

  if (candidateNumbers.some((number) => number && partNumbers.has(number))) {
    score += 50;
    reasons.push('shared part number');
  }

  const category = text(part.category).toLowerCase();
  if (category && text(candidate.category).toLowerCase() === category) {
    score += 20;
    reasons.push('same category');
  } else {
    const group = text(part.categoryGroup).toLowerCase();
    if (group && text(candidate.categoryGroup).toLowerCase() === group) {
      score += 8;
      reasons.push('same system');
    }
  }

  const { make, model } = dominantVehicle(part);
  const candidateMakes = uniqueStrings(
    (candidate.compatibleVehicles || []).map((vehicle) => vehicle?.make),
  ).map((value) => value.toLowerCase());
  const candidateModels = uniqueStrings(
    (candidate.compatibleVehicles || []).map((vehicle) => vehicle?.model),
  ).map((value) => value.toLowerCase());

  if (model && candidateModels.includes(model.toLowerCase())) {
    score += 15;
    reasons.push('same vehicle model');
  } else if (make && candidateMakes.includes(make.toLowerCase())) {
    score += 8;
    reasons.push('same vehicle make');
  }

  const brand = text(part.brand).toLowerCase();
  if (brand && text(candidate.brand).toLowerCase() === brand) {
    score += 5;
    reasons.push('same brand');
  }

  // A candidate with no image is a poor destination and, being noindex
  // itself, passes nothing on — so it is never worth a related slot.
  if (!uniqueStrings(candidate.imageUrls || []).length) {
    score = 0;
    reasons.length = 0;
  }

  return { candidate, score, reasons };
}

/**
 * Pick related products. Returns at most `limit`, strongest first, and never
 * pads the list to reach `limit` — a page with three genuinely related parts
 * shows three.
 */
export function selectRelated(
  part: SeoPartInput,
  candidates: RelatedCandidate[],
  limit = 8,
): ScoredRelated[] {
  return candidates
    .map((candidate) => scoreRelated(part, candidate))
    .filter((scored) => scored.score > 0 && text(scored.candidate.slug))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, limit);
}

/** Convert scored candidates into renderable links. */
export function relatedLinks(scored: ScoredRelated[]): SeoInternalLink[] {
  return scored.map((entry) => ({
    label: text(entry.candidate.title) || 'Related part',
    path: partPath(text(entry.candidate.slug)),
    relation: 'related' as const,
  }));
}
