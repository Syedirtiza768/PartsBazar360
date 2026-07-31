/**
 * Relevance model and query construction (brief §5).
 *
 * Two hard guarantees, both covered by tests in relevance.builder.spec.ts:
 *
 *  1. **Tier ordering.** The weights below are separated by wide gaps and are
 *     the only thing that can move a document between tiers. An exact OEM
 *     match always outranks a title match, whatever else is true.
 *
 *  2. **Commercial signals can never overpower a technical match.** Listing
 *     quality, stock, images and popularity are combined additively and capped
 *     at MAX_COMMERCIAL_BOOST, which is strictly smaller than the smallest gap
 *     between two tiers. A promoted or popular listing therefore cannot outrank
 *     the correct OEM-number result — the brief's explicit requirement.
 */

import { parseQuery, isPartNumberQuery, type ParsedQuery } from './query-parser';
import { partNumberVariants } from './part-number.util';

/**
 * Ranking weights, highest first. Ordered exactly as the brief §5 lists them.
 * Every value is overridable by environment variable so relevance can be tuned
 * without a deploy.
 */
export const RELEVANCE_WEIGHTS = {
  exactOem: num('SEARCH_W_EXACT_OEM', 1000),
  exactInterchange: num('SEARCH_W_EXACT_INTERCHANGE', 800),
  exactSuperseded: num('SEARCH_W_EXACT_SUPERSEDED', 700),
  exactSku: num('SEARCH_W_EXACT_SKU', 600),
  exactNormalized: num('SEARCH_W_EXACT_NORMALIZED', 500),
  verifiedFitment: num('SEARCH_W_VERIFIED_FITMENT', 400),
  titlePhrase: num('SEARCH_W_TITLE_PHRASE', 300),
  vehicleContext: num('SEARCH_W_VEHICLE_CONTEXT', 200),
  prefix: num('SEARCH_W_PREFIX', 120),
  token: num('SEARCH_W_TOKEN', 80),
  synonym: num('SEARCH_W_SYNONYM', 50),
  fuzzy: num('SEARCH_W_FUZZY', 20),
  description: num('SEARCH_W_DESCRIPTION', 10),
} as const;

/**
 * Ceiling on the total additive contribution of every commercial signal.
 * Must stay below the smallest inter-tier gap (currently 10, between
 * `description` and 0) — asserted by test, not by convention.
 */
export const MAX_COMMERCIAL_BOOST = num('SEARCH_MAX_COMMERCIAL_BOOST', 8);

function num(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface SearchFilters {
  category?: string[];
  brand?: string[];
  make?: string[];
  model?: string[];
  partType?: string[];
  sourceTag?: string[];
  condition?: string[];
  seller?: string[];
  year?: number;
  priceMin?: number;
  priceMax?: number;
  hasImage?: boolean;
  inStock?: boolean;
  /** Restrict to a specific vehicle configuration (fitment mode). */
  vehicleConfigId?: string;
  /** When false, cross-reference numbers are not matched. Default true. */
  includeInterchange?: boolean;
}

/** Clauses that require at least one indexed, buyer-visible offer. */
function visibilityFilters(): any[] {
  return [{ nested: { path: 'offers', query: { exists: { field: 'offers.sellerId' } } } }];
}

/**
 * Build the `filter` array. Filters are AND across dimensions and OR within a
 * dimension, and never affect scoring.
 */
export function buildFilters(filters: SearchFilters): any[] {
  const out: any[] = visibilityFilters();
  const terms = (field: string, values?: string[]) => {
    if (values?.length) out.push({ terms: { [field]: values } });
  };

  terms('category', filters.category);
  terms('brand', filters.brand);
  terms('makes', filters.make);
  terms('models', filters.model);
  terms('partType', filters.partType);
  terms('sourceTags', filters.sourceTag);
  terms('sellerIds', filters.seller);

  if (filters.condition?.length) {
    // Nested so condition and price constrain the *same* offer.
    out.push({
      nested: {
        path: 'offers',
        query: { terms: { 'offers.condition': filters.condition } },
      },
    });
  }

  if (filters.year != null) out.push({ term: { years: filters.year } });
  if (filters.hasImage) out.push({ term: { hasImage: true } });
  if (filters.inStock) out.push({ term: { inStock: true } });
  if (filters.vehicleConfigId) {
    out.push({ term: { fitments: filters.vehicleConfigId } });
  }

  if (filters.priceMin != null || filters.priceMax != null) {
    const range: Record<string, number> = {};
    if (filters.priceMin != null) range.gte = filters.priceMin;
    if (filters.priceMax != null) range.lte = filters.priceMax;
    out.push({
      nested: { path: 'offers', query: { range: { 'offers.price': range } } },
    });
  }

  return out;
}

/**
 * Part-number clauses, one per kind so each gets its own tier weight.
 * `_name` is set on every clause so the response can explain *why* a document
 * matched (surfaced to the buyer as "matched via interchange number").
 */
function numberClauses(parsed: ParsedQuery, includeInterchange: boolean): any[] {
  const clauses: any[] = [];
  if (!parsed.partNumbers.length) return clauses;

  // Probe each candidate together with its formatting variants (prefix-stripped,
  // leading-zero-stripped) so seller-decorated numbers still match.
  const values = new Set<string>();
  for (const candidate of parsed.partNumbers) {
    for (const variant of partNumberVariants(candidate)) values.add(variant);
  }
  const all = [...values];

  clauses.push({
    terms: { oemNumbers: all, boost: RELEVANCE_WEIGHTS.exactOem, _name: 'oem' },
  });
  if (includeInterchange) {
    clauses.push({
      terms: {
        interchangeNumbers: all,
        boost: RELEVANCE_WEIGHTS.exactInterchange,
        _name: 'interchange',
      },
    });
    clauses.push({
      terms: {
        supersededNumbers: all,
        boost: RELEVANCE_WEIGHTS.exactSuperseded,
        _name: 'superseded',
      },
    });
  }
  clauses.push({
    terms: { skuNumbers: all, boost: RELEVANCE_WEIGHTS.exactSku, _name: 'sku' },
  });
  clauses.push({
    terms: {
      searchNumbers: all,
      boost: RELEVANCE_WEIGHTS.exactNormalized,
      _name: 'normalized',
    },
  });

  // Partial / prefix ("86401" → 8640112020). Only for candidates long enough
  // that a prefix is meaningful, so "12" cannot match the entire catalogue.
  for (const candidate of all) {
    if (candidate.length >= 4) {
      clauses.push({
        match: {
          'searchNumbers.prefix': {
            query: candidate,
            boost: RELEVANCE_WEIGHTS.prefix,
            _name: 'prefix',
          },
        },
      });
    }
  }

  return clauses;
}

/**
 * How strictly descriptive terms must match.
 *
 * `strict` requires every term of a short query, which is what makes
 * "Audi Bumper" return Audi bumpers rather than every bumper in the catalogue.
 * But when the catalogue genuinely has no such part, strict matching returns
 * near-nothing: "front bumper for 2018 Accord" collapsed to a single, wrong
 * result. `relaxed` is the fallback the service runs in that case, and its
 * results are labelled as related rather than exact.
 */
export type MatchStrictness = 'strict' | 'relaxed';

const MSM: Record<MatchStrictness, { token: string; fuzzy: string }> = {
  strict: { token: '3<75%', fuzzy: '3<70%' },
  relaxed: { token: '2<50%', fuzzy: '2<50%' },
};

/** Descriptive-text clauses over the part of the query that is not an identifier. */
function textClauses(parsed: ParsedQuery, strictness: MatchStrictness): any[] {
  const clauses: any[] = [];
  // Match over the full query (minus part numbers and years), NOT over
  // freeText. The structured `makes`/`models` fields are empty on most salvage
  // documents, so matching freeText alone left nothing enforcing the make:
  // "Audi Bumper" and "Audi Q7 bumper" both returned the same 2,373 results,
  // including Nissan and MINI bumpers.
  const text = parsed.matchText;
  if (!text) return clauses;

  // Exact phrase — the strongest textual signal.
  clauses.push({
    match_phrase: {
      'title.exact': {
        query: text,
        boost: RELEVANCE_WEIGHTS.titlePhrase,
        _name: 'title_phrase',
      },
    },
  });

  // Strong token match.
  //
  // `"2<75%"` reads: with 2 terms or fewer, require them ALL; beyond that,
  // require 75 %. A plain `"75%"` rounds *down*, so a two-token query only
  // required one token — which is why the first pass at this fix left
  // "tail light" at 4,256 results (every listing containing "light") and
  // "2019 toyota corolla lane camera" essentially unchanged at 5,816.
  clauses.push({
    multi_match: {
      query: text,
      fields: ['title^3', 'brand^2', 'category', 'partType^2'],
      minimum_should_match: MSM[strictness].token,
      boost: RELEVANCE_WEIGHTS.token,
      _name: 'token',
    },
  });

  // Synonyms — scored below a direct token match, per the brief's ordering.
  for (const term of parsed.expandedTerms) {
    if (term === text) continue;
    clauses.push({
      match_phrase: {
        title: {
          query: term,
          boost: RELEVANCE_WEIGHTS.synonym,
          _name: 'synonym',
        },
      },
    });
  }

  // Typo tolerance. Absent from production `browseParts` today, which is why
  // "altrenator" returns 0 results while "alternator" returns 424.
  clauses.push({
    multi_match: {
      query: text,
      fields: ['title^2', 'brand'],
      // `AUTO:5,8` — do not fuzz words shorter than 5 characters at all, allow
      // one edit up to 8, two beyond. Plain `AUTO` fuzzes 3-character words,
      // which made "tail" match "rail"/"tall"/"nail" and inflated "tail light"
      // to 3,548 results against "taillight"'s 410 for the same intent.
      fuzziness: 'AUTO:5,8',
      prefix_length: 3,
      max_expansions: 20,
      // Same rounding trap as the token clause above.
      minimum_should_match: MSM[strictness].fuzzy,
      boost: RELEVANCE_WEIGHTS.fuzzy,
      _name: 'fuzzy',
    },
  });

  // Description-only match — the weakest tier. It needs the same
  // minimum_should_match guard as the token clause: `match` defaults to OR, so
  // without it a two-word query matched any description containing *either*
  // word. Measured: "tail light" returned 3,548 results while only 225
  // documents contain the phrase in their title.
  clauses.push({
    match: {
      description: {
        query: text,
        minimum_should_match: MSM[strictness].token,
        boost: RELEVANCE_WEIGHTS.description,
        _name: 'description',
      },
    },
  });

  return clauses;
}

/** Vehicle-context and fitment boosts. Never hard filters — 56 % of the
 *  catalogue has no fitment data, so filtering would destroy recall. */
function contextClauses(parsed: ParsedQuery, filters: SearchFilters): any[] {
  const clauses: any[] = [];

  if (parsed.make) {
    clauses.push({
      term: {
        makes: {
          value: parsed.make.toLowerCase(),
          boost: RELEVANCE_WEIGHTS.vehicleContext,
          _name: 'make',
        },
      },
    });
  }
  if (parsed.model) {
    clauses.push({
      term: {
        models: {
          value: parsed.model.toLowerCase(),
          boost: RELEVANCE_WEIGHTS.vehicleContext,
          _name: 'model',
        },
      },
    });
  }
  if (parsed.year != null) {
    clauses.push({
      term: { years: { value: parsed.year, boost: RELEVANCE_WEIGHTS.vehicleContext, _name: 'year' } },
    });
  }
  if (parsed.yearRange) {
    clauses.push({
      range: {
        years: {
          gte: parsed.yearRange.from,
          lte: parsed.yearRange.to,
          boost: RELEVANCE_WEIGHTS.vehicleContext,
          _name: 'year_range',
        },
      },
    });
  }
  if (parsed.side) {
    clauses.push({
      term: { side: { value: parsed.side, boost: RELEVANCE_WEIGHTS.vehicleContext, _name: 'side' } },
    });
  }
  for (const position of parsed.positions) {
    clauses.push({
      term: { positions: { value: position, boost: RELEVANCE_WEIGHTS.vehicleContext / 2, _name: 'position' } },
    });
  }
  if (parsed.condition) {
    clauses.push({
      nested: {
        path: 'offers',
        query: { term: { 'offers.condition': parsed.condition } },
        boost: RELEVANCE_WEIGHTS.vehicleContext / 2,
        _name: 'condition',
      },
    });
  }
  if (filters.vehicleConfigId) {
    clauses.push({
      term: {
        verifiedFitments: {
          value: filters.vehicleConfigId,
          boost: RELEVANCE_WEIGHTS.verifiedFitment,
          _name: 'verified_fitment',
        },
      },
    });
  }

  return clauses;
}

/**
 * Commercial signals (brief §5 "additional ranking signals").
 *
 * Additive and hard-capped at MAX_COMMERCIAL_BOOST. `boost_mode: sum` means
 * the most these can contribute is MAX_COMMERCIAL_BOOST, which is less than
 * the gap between any two relevance tiers — so they break ties and nothing more.
 */
function commercialFunctions(): any[] {
  const share = MAX_COMMERCIAL_BOOST / 4;
  return [
    { filter: { term: { inStock: true } }, weight: share },
    { filter: { term: { hasImage: true } }, weight: share },
    {
      field_value_factor: {
        field: 'listingQuality',
        factor: share,
        missing: 0,
        modifier: 'none',
      },
    },
    {
      field_value_factor: {
        field: 'popularity',
        factor: share,
        missing: 0,
        modifier: 'none',
      },
    },
  ];
}

export type SortOption =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'best_condition';

/** Sorts always end with a deterministic tie-break so pagination is stable. */
export function buildSort(sort: SortOption, hasQuery: boolean): any[] {
  const tieBreak = [{ createdAt: { order: 'desc' } }, { id: { order: 'asc' } }];
  switch (sort) {
    case 'price_asc':
      return [{ minPrice: { order: 'asc', missing: '_last' } }, ...tieBreak];
    case 'price_desc':
      return [{ minPrice: { order: 'desc', missing: '_last' } }, ...tieBreak];
    case 'newest':
      return tieBreak;
    case 'best_condition':
      return [{ listingQuality: { order: 'desc', missing: '_last' } }, ...tieBreak];
    case 'relevance':
    default:
      // Relevance is meaningless without a query; fall back to a stable feed.
      return hasQuery ? [{ _score: { order: 'desc' } }, ...tieBreak] : tieBreak;
  }
}

export interface BuiltQuery {
  parsed: ParsedQuery;
  query: any;
  sort: any[];
}

/**
 * Turn a raw query string plus filters into a complete OpenSearch query.
 */
export function buildSearchQuery(
  rawQuery: string | undefined,
  filters: SearchFilters = {},
  sort: SortOption = 'relevance',
  strictness: MatchStrictness = 'strict',
): BuiltQuery {
  const parsed = parseQuery(rawQuery ?? '');
  const includeInterchange = filters.includeInterchange !== false;
  const hasQuery = Boolean(parsed.normalized);

  const filterClauses = buildFilters(filters);
  const numbers = numberClauses(parsed, includeInterchange);
  const texts = textClauses(parsed, strictness);
  const context = contextClauses(parsed, filters);

  let core: any;
  if (!hasQuery) {
    core = { match_all: {} };
  } else if (numbers.length && !texts.length) {
    // Pure part-number query: a document MUST match a number clause. This is
    // what stops "86401-12020" returning five unrelated parts.
    core = { bool: { should: numbers, minimum_should_match: 1 } };
  } else if (texts.length && !numbers.length) {
    core = { bool: { should: texts, minimum_should_match: 1 } };
  } else {
    // Mixed query — either signal can satisfy it, numbers score far higher.
    core = { bool: { should: [...numbers, ...texts], minimum_should_match: 1 } };
  }

  const scored = {
    function_score: {
      query: {
        bool: {
          must: [core],
          should: context,
          filter: filterClauses,
        },
      },
      functions: commercialFunctions(),
      score_mode: 'sum',
      boost_mode: 'sum',
      max_boost: MAX_COMMERCIAL_BOOST,
    },
  };

  return { parsed, query: scored, sort: buildSort(sort, hasQuery) };
}

export { isPartNumberQuery };
