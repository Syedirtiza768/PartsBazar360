/**
 * Title, description, and H1 generation.
 *
 * Each generator is an explicit fallback chain, evaluated top to bottom, that
 * ends in a value which cannot fail. That structure is the answer to two
 * requirements at once: an admin override always wins (it is step 1), and a
 * missing attribute degrades to the next-best template instead of producing
 * `undefined` or `Toyota | | Camera`.
 *
 * The templates never state anything the data does not: no invented fitment,
 * no invented specification, no "best price" claim. Every clause is
 * conditional on the field it names being present.
 */

import { seoConfig } from './config';
import { purchasableOffers } from './indexability';
import { dominantVehicle, primaryPartNumber } from './slug';
import {
  clip,
  clipHard,
  dedupeWords,
  endSentence,
  humanizeToken,
  joinParts,
  normalizeIdentifier,
  removeRedundant,
  stripHtml,
  stripListingNoise,
  text,
  titleCase,
  uniqueStrings,
} from './text';
import type { SeoPartInput, SeoTaxonomyInput } from './types';

/** Append the brand suffix, but only if it still fits the title budget. */
export function withSiteName(core: string): string {
  const { siteName, titleSeparator, limits } = seoConfig();
  const trimmed = text(core);
  if (!trimmed) return siteName;
  const suffixed = `${trimmed}${titleSeparator}${siteName}`;
  // A truncated brand ("PartsBaz…") looks broken, so drop the suffix whole
  // rather than clip through it.
  return suffixed.length <= limits.title ? suffixed : trimmed;
}

/**
 * The descriptive core of a part's name, with brand/vehicle/number removed so
 * templates can re-add them in a controlled order without stuttering.
 */
export function partNameCore(part: SeoPartInput): string {
  const brand = text(part.brand) || text(part.manufacturer);
  const { make, model } = dominantVehicle(part);
  const number = primaryPartNumber(part);

  let name = text(part.title);
  for (const redundant of [brand, make, model]) {
    if (redundant) name = removeRedundant(name, redundant);
  }
  if (number) {
    const normalized = normalizeIdentifier(number);
    name = name
      .split(/\s+/)
      .filter((token) => normalizeIdentifier(token) !== normalized)
      .join(' ');
  }
  name = text(name);
  // Leading/trailing punctuation left behind by the removals above.
  name = name.replace(/^[\s\-–—,|/]+|[\s\-–—,|/]+$/g, '');
  name = stripListingNoise(name);
  return text(name) || text(part.category) || text(part.title);
}

/** "Toyota Corolla" / "Toyota" / "" — only when the part fits one vehicle. */
export function vehicleLabel(part: SeoPartInput): string {
  const { make, model } = dominantVehicle(part);
  return joinParts([titleCase(make), titleCase(model)]);
}

/**
 * The leading "who and what vehicle" phrase.
 *
 * When the brand *is* the vehicle make — which is the norm for OEM parts,
 * where Toyota both makes the car and brands the part — the standalone brand
 * is dropped, because the vehicle label already leads with it. Without this,
 * every OEM listing reads "Toyota Toyota Corolla".
 */
export function subjectPrefix(part: SeoPartInput): string {
  const brand = titleCase(text(part.brand) || text(part.manufacturer));
  const vehicle = vehicleLabel(part);
  if (!vehicle) return brand;
  if (!brand) return vehicle;
  return dedupeWords(joinParts([brand, vehicle]));
}

/**
 * `<title>` for a product detail page.
 *
 * Built by budget allocation rather than by picking whichever pre-joined
 * candidate happens to fit. The subject prefix (brand/vehicle) and the part
 * number are the two highest-intent tokens a buyer types, so they are
 * reserved first and the descriptive name absorbs whatever budget is left.
 * Picking "first candidate under 60 chars" silently dropped the brand from
 * every long listing title, which is the opposite of what should give way.
 */
export function partTitle(part: SeoPartInput): string {
  const { limits, siteName } = seoConfig();
  const override = text(part.seo?.title);
  if (override) return clip(override, limits.title);

  const prefix = subjectPrefix(part);
  const name = titleCase(partNameCore(part));
  const number = primaryPartNumber(part);
  const budget = limits.titleCore;

  // Two spaces of separator once prefix and number are both present.
  const reserved = prefix.length + number.length + 2;
  const nameBudget = budget - reserved;

  // Enough room for a meaningful fragment of the name: keep everything.
  if (name && nameBudget >= 14) {
    return clip(
      dedupeWords(joinParts([prefix, clipHard(name, nameBudget), number])),
      budget,
    );
  }

  // Too tight. Shed the least valuable element first — the vehicle model,
  // then the vehicle entirely — before ever dropping the name or the number.
  const brandOnly = titleCase(text(part.brand) || text(part.manufacturer));
  const fallbacks = [
    joinParts([brandOnly, name, number]),
    joinParts([name, number]),
    joinParts([prefix, number]),
    text(part.title),
    joinParts([brandOnly, titleCase(part.category)]),
    joinParts([titleCase(part.category), 'auto part']),
  ].map((candidate) => dedupeWords(candidate));

  const fitting = fallbacks.find(
    (candidate) => candidate && candidate.length <= budget,
  );
  return clip(fitting || fallbacks.find(Boolean) || siteName, budget);
}

/**
 * `<h1>` for a product detail page. Longer budget than the title, and uses an
 * en dash before the part number the way a spec sheet would.
 */
export function partH1(part: SeoPartInput): string {
  const { limits } = seoConfig();
  const override = text(part.seo?.h1);
  if (override) return clip(override, limits.h1);

  const name = titleCase(partNameCore(part));
  const number = primaryPartNumber(part);

  const lead = dedupeWords(joinParts([subjectPrefix(part), name])) || text(part.title);
  if (!lead) return clip(partTitle(part), limits.h1);
  // "OEM 86401-12020" only when the number really is an OE number; an
  // aftermarket MPN is labelled "Part No." so the page never overclaims.
  const isOem = Boolean(
    text(part.genuineOemPartNumber) ||
      (part.oeNumbers || []).some(
        (value) => normalizeIdentifier(value) === normalizeIdentifier(number),
      ),
  );
  const numberClause = number ? `${isOem ? 'OEM' : 'Part No.'} ${number}` : '';
  return clip(joinParts([lead, numberClause], ' – '), limits.h1);
}

/**
 * Meta description for a product detail page.
 *
 * Prefers the seller's own prose when it is substantial, because that is the
 * most specific text available. Falls back to a template assembled strictly
 * from present attributes.
 */
export function partDescription(part: SeoPartInput): string {
  const { limits, thresholds } = seoConfig();
  const override = text(part.seo?.description);
  if (override) return clip(override, limits.description);

  const prose = stripHtml(part.description);
  const name = titleCase(partNameCore(part));
  const number = primaryPartNumber(part);
  const condition = humanizeToken(part.qualityTier);
  const offers = purchasableOffers(part);

  const subject =
    dedupeWords(joinParts([subjectPrefix(part), name])) || text(part.title);

  // Seller prose is used only when it is long enough to be a real sentence;
  // a 20-character description makes a worse snippet than the template.
  if (prose.length >= thresholds.minDescriptionChars) {
    const tail = joinParts(
      [
        number ? `Part number ${number}.` : '',
        offers.length > 1 ? `Compare ${offers.length} seller offers.` : '',
      ],
      ' ',
    );
    return clip(joinParts([endSentence(prose), tail], ' '), limits.description);
  }

  const clauses = [
    subject ? `Buy ${subject}` : 'Buy automotive parts',
    number ? `part number ${number}` : '',
    condition ? `${condition.toLowerCase()} condition` : '',
  ];
  const opener = endSentence(joinParts(clauses, ', '));

  const detail = joinParts(
    [
      offers.length > 1
        ? `Compare ${offers.length} seller offers`
        : offers.length === 1
          ? 'Check price and availability'
          : 'Check availability',
      'view fitment details, condition and shipping',
      `on ${seoConfig().siteName}`,
    ],
    ', ',
  );

  return clip(joinParts([opener, endSentence(detail)], ' '), limits.description);
}

// ---------------------------------------------------------------------------
// Taxonomy pages
// ---------------------------------------------------------------------------

/** Human label for a taxonomy node, including its parent context. */
export function taxonomyLabel(node: SeoTaxonomyInput): string {
  const parentOf = (kind: string): string =>
    titleCase((node.parents || []).find((parent) => parent.kind === kind)?.name);

  const name = titleCase(node.name);
  switch (node.kind) {
    case 'model':
      return joinParts([parentOf('make'), name]);
    case 'modelYear':
      return joinParts([node.year, parentOf('make'), parentOf('model')]);
    default:
      return name;
  }
}

/** Noun phrase describing what the page lists, e.g. "Toyota Corolla Parts". */
export function taxonomyHeading(node: SeoTaxonomyInput): string {
  const label = taxonomyLabel(node);
  if (!label) return 'Auto Parts';
  switch (node.kind) {
    case 'brand':
      return `${label} Auto Parts`;
    case 'make':
    case 'model':
    case 'modelYear':
      return `${label} Parts`;
    case 'categoryGroup':
      return `${label} System Parts`;
    case 'category':
    default:
      // A category name is already the noun a buyer searches ("Brake Pads").
      // Appending "Parts" produces "Brake Pads Parts", which reads as filler
      // and dilutes the exact-match term the page is built to rank for.
      return label;
  }
}

export function taxonomyTitle(node: SeoTaxonomyInput): string {
  const { limits } = seoConfig();
  const override = text(node.seo?.title);
  if (override) return clip(override, limits.title);

  const heading = taxonomyHeading(node);
  const page = node.page ?? 1;
  // Paginated pages carry a distinct title so they never look duplicate to a
  // crawler that reaches them despite the noindex.
  const paged = page > 1 ? `${heading} – Page ${page}` : heading;
  return clip(paged, limits.titleCore);
}

export function taxonomyH1(node: SeoTaxonomyInput): string {
  const { limits } = seoConfig();
  const override = text(node.seo?.h1);
  if (override) return clip(override, limits.h1);
  return clip(taxonomyHeading(node), limits.h1);
}

export function taxonomyDescription(node: SeoTaxonomyInput): string {
  const { limits, siteName } = seoConfig();
  const override = text(node.seo?.description);
  if (override) return clip(override, limits.description);

  const label = taxonomyLabel(node) || 'auto';
  const count = node.productCount;
  // Only state a count when there is one; "Browse 0 listings" is worse than
  // saying nothing, and an approximate count would be a false claim.
  const countClause =
    count > 0
      ? `Browse ${count.toLocaleString('en-US')} listing${count === 1 ? '' : 's'}`
      : 'Browse live listings';

  const subject =
    node.kind === 'brand'
      ? `${label} automotive parts`
      : node.kind === 'make' || node.kind === 'model' || node.kind === 'modelYear'
        ? `parts for ${label}`
        : `${label.toLowerCase()} parts`;

  const children = uniqueStrings((node.children || []).map((child) => titleCase(child.name)))
    .slice(0, 3)
    .join(', ');

  return clip(
    joinParts(
      [
        endSentence(`${countClause} of ${subject} on ${siteName}`),
        children ? endSentence(`Includes ${children}`) : '',
        'Compare condition, part numbers, seller terms and shipping before you buy.',
      ],
      ' ',
    ),
    limits.description,
  );
}
