/**
 * Versioned search-index schema (brief §3, §15, §19).
 *
 * The live `canonical_parts` index is 100 % dynamically mapped — every field
 * landed as `text` + `.keyword`, the explicit mapping in `opensearch.service.ts`
 * was never applied because `ensureIndex()` only sends it on create and the
 * index already existed. See docs/SEARCH_PHASE1_AUDIT.md §4 RC-2.
 *
 * Consequences that this schema fixes:
 *  - `offers` is an `object`, so offer sub-fields cross-contaminate between the
 *    offers of one part and condition/price/seller facets cannot be correct.
 *    Here it is `nested`.
 *  - There is no way to match a part number whose separators differ from the
 *    indexed form, and no way to match a partial number. Here numbers live in
 *    pre-normalized keyword fields plus an edge-ngram prefix field.
 *  - There are no fields at all for condition, year, side, stock, or image
 *    availability at part level, so those facets could not exist.
 *
 * Deliberately NOT here: synonyms. They are applied at query time by
 * `query/query-parser.ts` instead of an analyzer-level `synonym_graph`, because
 * the brief (§5) ranks a synonym match *below* a direct token match. An
 * analyzer-level synonym is indistinguishable from a direct match at scoring
 * time; an application-level one gets its own clause and its own lower boost.
 * It is also versionable and unit-testable without a reindex.
 */

/** Bump when the mapping changes in a way that requires a rebuild. */
export const SEARCH_INDEX_VERSION = 2;

/** Alias the application reads and writes through. Never a physical index. */
export const SEARCH_ALIAS = 'parts_search';

/** Physical index name for a given version. */
export function physicalIndexName(version = SEARCH_INDEX_VERSION): string {
  return `canonical_parts_v${version}`;
}

export const searchIndexSettings = {
  number_of_shards: Number(process.env.OPENSEARCH_SHARDS || 1),
  number_of_replicas: Number(process.env.OPENSEARCH_REPLICAS || 0),
  max_result_window: Number(process.env.OPENSEARCH_MAX_RESULT_WINDOW || 100_000),
  analysis: {
    char_filter: {
      // "86401-12020" → "8640112020". The single most important transform in
      // the whole index: it is what makes every separator form equivalent.
      pb_strip_separators: {
        type: 'pattern_replace',
        pattern: '[^A-Za-z0-9]',
        replacement: '',
      },
    },
    filter: {
      // Partial part-number search ("86401" → 8640112020). min_gram 3 keeps the
      // index from exploding on 1–2 character fragments that match everything.
      pb_partnum_edge: {
        type: 'edge_ngram',
        min_gram: 3,
        max_gram: 20,
      },
      pb_english_stem: {
        type: 'stemmer',
        language: 'light_english',
      },
      // Guards against a pathological token blowing up the analyzer.
      pb_length_guard: {
        type: 'length',
        max: 40,
      },
    },
    analyzer: {
      // Descriptive text. asciifolding so "Citroën" matches "Citroen" and the
      // German/Italian seller titles in this catalogue fold to ASCII.
      pb_text: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'pb_english_stem'],
      },
      // Same, without stemming — used for exact-phrase scoring so "brake pad"
      // does not phrase-match "brake pads" at full exact-phrase weight.
      pb_text_exact: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding'],
      },
      // Whole part number as one separator-free token, index side, with edge
      // ngrams for prefix matching.
      pb_partnum_prefix_index: {
        type: 'custom',
        char_filter: ['pb_strip_separators'],
        tokenizer: 'keyword',
        filter: ['lowercase', 'pb_length_guard', 'pb_partnum_edge'],
      },
      // Query side: strip separators, lowercase, but do NOT ngram the query —
      // otherwise every prefix of the query would match everything.
      pb_partnum_prefix_search: {
        type: 'custom',
        char_filter: ['pb_strip_separators'],
        tokenizer: 'keyword',
        filter: ['lowercase', 'pb_length_guard'],
      },
    },
    normalizer: {
      // Case/accent-insensitive exact keyword matching for facet values.
      pb_keyword: {
        type: 'custom',
        filter: ['lowercase', 'asciifolding'],
      },
    },
  },
} as const;

export const searchIndexMappings = {
  dynamic: 'strict' as const,
  properties: {
    id: { type: 'keyword' },

    // ---- descriptive text -------------------------------------------------
    title: {
      type: 'text',
      analyzer: 'pb_text',
      fields: {
        exact: { type: 'text', analyzer: 'pb_text_exact' },
        keyword: { type: 'keyword', ignore_above: 512 },
      },
    },
    description: { type: 'text', analyzer: 'pb_text' },

    // ---- part numbers -----------------------------------------------------
    // Split by kind so the ranking layer can honour the brief's §5 order:
    // exact OEM > interchange > superseded > SKU > any normalized number.
    // All values are pre-normalized by normalizePartNumber() before indexing.
    oemNumbers: { type: 'keyword' },
    interchangeNumbers: { type: 'keyword' },
    supersededNumbers: { type: 'keyword' },
    skuNumbers: { type: 'keyword' },
    /** Union of every number above — the catch-all exact match. */
    searchNumbers: {
      type: 'keyword',
      fields: {
        // Prefix/partial matching: "86401" finds 8640112020.
        prefix: {
          type: 'text',
          analyzer: 'pb_partnum_prefix_index',
          search_analyzer: 'pb_partnum_prefix_search',
        },
      },
    },
    /** Original, un-normalized forms. Display and audit only (brief §4). */
    displayNumbers: { type: 'keyword', index: false },
    manufacturerPartNumber: {
      type: 'keyword',
      fields: { text: { type: 'text', analyzer: 'pb_text_exact' } },
    },

    // ---- taxonomy / facets ------------------------------------------------
    brand: { type: 'keyword', normalizer: 'pb_keyword' },
    brandDisplay: { type: 'keyword', index: false },
    category: { type: 'keyword', normalizer: 'pb_keyword' },
    partType: { type: 'keyword', normalizer: 'pb_keyword' },
    /** Provenance (SALVAGE_OEM / GENUINE_OEM / AFTERMARKET). Distinct from
     *  partType, which the current data conflates. See audit RC-5. */
    partSource: { type: 'keyword' },
    qualityTier: { type: 'keyword' },
    sourceTags: { type: 'keyword' },
    makes: { type: 'keyword', normalizer: 'pb_keyword' },
    models: { type: 'keyword', normalizer: 'pb_keyword' },
    /** Model years this part is known to fit, for the year facet. */
    years: { type: 'integer' },
    side: { type: 'keyword' },
    positions: { type: 'keyword' },

    // ---- commerce ---------------------------------------------------------
    /** Rolled up from offers so condition can be faceted at part level. */
    conditions: { type: 'keyword' },
    minPrice: { type: 'float' },
    maxPrice: { type: 'float' },
    currencies: { type: 'keyword' },
    sellerIds: { type: 'keyword' },
    sellerNames: { type: 'keyword', normalizer: 'pb_keyword' },
    offerCount: { type: 'integer' },
    inStock: { type: 'boolean' },
    hasImage: { type: 'boolean' },
    freeShipping: { type: 'boolean' },

    // ---- fitment ----------------------------------------------------------
    fitments: { type: 'keyword' },
    fitmentStatus: { type: 'keyword' },
    fitmentConfidence: { type: 'float' },
    /** Vehicle-configuration ids with A/B evidence — the "confirmed fit" set. */
    verifiedFitments: { type: 'keyword' },

    // ---- ranking signals (brief §5, secondary to technical match) ---------
    /** 0–1 completeness: image, description, numbers, fitment present. */
    listingQuality: { type: 'float' },
    popularity: { type: 'float' },

    // ---- media / links ----------------------------------------------------
    imageUrls: { type: 'keyword', index: false },
    listingUrl: { type: 'keyword', index: false },
    ebayItemId: { type: 'keyword' },

    // ---- housekeeping -----------------------------------------------------
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
    /** Set by the indexer; lets the reconcile job spot stale documents. */
    indexedAt: { type: 'date' },

    // ---- offers -----------------------------------------------------------
    // `nested` (not `object`) so a filter on {condition:NEW, price<100} cannot
    // be satisfied by a NEW offer at 900 and a USED offer at 50.
    offers: {
      type: 'nested',
      properties: {
        id: { type: 'keyword' },
        sellerId: { type: 'keyword' },
        sellerName: { type: 'keyword', normalizer: 'pb_keyword' },
        price: { type: 'float' },
        currency: { type: 'keyword' },
        condition: { type: 'keyword' },
        partSource: { type: 'keyword' },
        qualityTier: { type: 'keyword' },
        sourceTag: { type: 'keyword' },
        inStock: { type: 'boolean' },
        freeShipping: { type: 'boolean' },
      },
    },
  },
} as const;

export function buildIndexBody() {
  return { settings: searchIndexSettings, mappings: searchIndexMappings };
}
