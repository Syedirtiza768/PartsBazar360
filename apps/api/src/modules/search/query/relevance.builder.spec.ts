import {
  RELEVANCE_WEIGHTS,
  MAX_COMMERCIAL_BOOST,
  buildSearchQuery,
  buildFilters,
  buildSort,
} from './relevance.builder';

/** Collect every clause carrying `_name`, keyed by name, with its boost. */
function namedClauses(node: any, out: Record<string, number[]> = {}) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) namedClauses(child, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      const v = value as any;
      if (typeof v._name === 'string') {
        (out[v._name] ??= []).push(typeof v.boost === 'number' ? v.boost : 0);
      }
      namedClauses(value, out);
    }
  }
  return out;
}

function jsonOf(node: any): string {
  return JSON.stringify(node);
}

describe('relevance tier ordering (brief §5)', () => {
  it('orders the weights exactly as the brief specifies', () => {
    const w = RELEVANCE_WEIGHTS;
    const ordered = [
      w.exactOem,
      w.exactInterchange,
      w.exactSuperseded,
      w.exactSku,
      w.exactNormalized,
      w.verifiedFitment,
      w.titlePhrase,
      w.vehicleContext,
      w.prefix,
      w.token,
      w.synonym,
      w.fuzzy,
      w.description,
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeLessThan(ordered[i - 1]);
    }
  });

  it('scores an exact OEM match above every textual signal', () => {
    const w = RELEVANCE_WEIGHTS;
    expect(w.exactOem).toBeGreaterThan(w.titlePhrase);
    expect(w.exactOem).toBeGreaterThan(w.token);
    expect(w.exactOem).toBeGreaterThan(w.fuzzy);
  });

  it('scores a synonym match below a direct token match', () => {
    expect(RELEVANCE_WEIGHTS.synonym).toBeLessThan(RELEVANCE_WEIGHTS.token);
  });
});

describe('commercial signals cannot overpower a technical match (brief §5)', () => {
  it('caps total commercial contribution below the smallest tier gap', () => {
    const weights = Object.values(RELEVANCE_WEIGHTS).sort((a, b) => a - b);
    const smallestGap = Math.min(
      weights[0],
      ...weights.slice(1).map((value, i) => value - weights[i]),
    );
    expect(MAX_COMMERCIAL_BOOST).toBeLessThan(smallestGap);
  });

  it('applies commercial signals additively with a hard max_boost', () => {
    const { query } = buildSearchQuery('alternator');
    expect(query.function_score.boost_mode).toBe('sum');
    expect(query.function_score.max_boost).toBe(MAX_COMMERCIAL_BOOST);
  });

  it('cannot lift a popular listing over an exact OEM match', () => {
    // Worst case: a document with every commercial signal maxed, matching only
    // the weakest tier, versus a document matching the strongest tier.
    const bestNonTechnical = RELEVANCE_WEIGHTS.description + MAX_COMMERCIAL_BOOST;
    expect(bestNonTechnical).toBeLessThan(RELEVANCE_WEIGHTS.exactOem);
    expect(bestNonTechnical).toBeLessThan(RELEVANCE_WEIGHTS.exactNormalized);
  });
});

describe('part-number queries', () => {
  it('requires a number match for a bare part number', () => {
    // Production defect: "86401-12020" returned 5 unrelated parts.
    const { query, parsed } = buildSearchQuery('86401-12020');
    expect(parsed.partNumbers).toContain('8640112020');

    const core = query.function_score.query.bool.must[0];
    expect(core.bool.minimum_should_match).toBe(1);
    // Every clause in the required group is a number clause — no text clause
    // can satisfy the query on its own.
    const names = Object.keys(namedClauses(core));
    expect(names).toEqual(
      expect.arrayContaining(['oem', 'normalized', 'prefix']),
    );
    expect(names).not.toContain('token');
    expect(names).not.toContain('fuzzy');
  });

  it('matches every separator variant identically', () => {
    const forms = ['8640112020', '86401-12020', '86401 12020', '86401/12020'];
    const built = forms.map((f) => jsonOf(buildSearchQuery(f).query));
    expect(new Set(built).size).toBe(1);
  });

  it('emits a prefix clause so a partial number can match', () => {
    // Production: "86401" returned 0 results.
    const { query } = buildSearchQuery('86401');
    expect(jsonOf(query)).toContain('searchNumbers.prefix');
  });

  it('omits interchange clauses when the buyer opts out', () => {
    const on = jsonOf(buildSearchQuery('8640112020', { includeInterchange: true }).query);
    const off = jsonOf(buildSearchQuery('8640112020', { includeInterchange: false }).query);
    expect(on).toContain('interchangeNumbers');
    expect(off).not.toContain('interchangeNumbers');
  });

  it('names clauses so the response can explain why a document matched', () => {
    const { query } = buildSearchQuery('8640112020');
    const names = Object.keys(namedClauses(query));
    expect(names).toEqual(expect.arrayContaining(['oem', 'interchange', 'normalized']));
  });
});

describe('descriptive queries', () => {
  it('requires most tokens to match, not just one', () => {
    // Production defect: "2019 toyota corolla lane camera" returned 5,834
    // results because any single token satisfied the query.
    const { query } = buildSearchQuery('2019 toyota corolla lane camera');
    const clauses = namedClauses(query);
    expect(clauses.token).toBeDefined();
    expect(jsonOf(query)).toContain(String.raw`"minimum_should_match":"3<75%"`);
  });

  it('requires ALL terms of a short query, not a rounded-down fraction', () => {
    // A plain "75%" rounds down, so a two-token query required only one token.
    // Measured effect on the real index: "tail light" returned 4,256 results
    // (every listing containing "light") instead of tail lights.
    const body = jsonOf(buildSearchQuery('tail light').query);
    expect(body).not.toContain('"minimum_should_match":"75%"');
    expect(body).toContain(String.raw`"minimum_should_match":"3<75%"`);
    expect(body).not.toContain('"minimum_should_match":"60%"');
  });

  it('guards every text clause against OR-matching, including description', () => {
    // `match` defaults to OR. The description clause was the last unguarded
    // one: "tail light" matched any description containing "tail" OR "light",
    // returning 3,548 results when only 225 documents have the phrase in
    // their title.
    const clauses = buildSearchQuery('tail light').query.function_score.query.bool
      .must[0].bool.should;
    const textual = clauses.filter((clause: any) =>
      ['multi_match', 'match'].includes(Object.keys(clause)[0]),
    );
    expect(textual.length).toBeGreaterThan(0);
    for (const clause of textual) {
      const body: any = Object.values(clause)[0];
      const nested = Object.values(body)[0] as Record<string, unknown> | undefined;
      const spec = body.minimum_should_match ?? nested?.minimum_should_match;
      expect(spec).toBeDefined();
    }
  });

  it('adds typo tolerance', () => {
    // Production: "altrenator" returned 0 results.
    const { query } = buildSearchQuery('altrenator');
    expect(jsonOf(query)).toContain('"fuzziness":"AUTO:5,8"');
  });

  it('expands synonyms so "taillight" and "tail light" search alike', () => {
    // Production: 22 vs 983 results for the same intent.
    const joined = buildSearchQuery('taillight');
    const spaced = buildSearchQuery('tail light');
    expect(new Set(joined.parsed.expandedTerms)).toEqual(
      new Set(spaced.parsed.expandedTerms),
    );
    expect(namedClauses(joined.query).synonym?.length).toBeGreaterThan(0);
  });

  it('keeps the make in the text query, not only in the structured field', () => {
    // Measured defect: "Audi Bumper" and "Audi Q7 bumper" both returned the
    // identical 2,373 results — every bumper in the catalogue, including
    // Nissan and MINI — because the make was stripped from the text query and
    // the structured `makes` field is empty on most salvage documents.
    const audi = buildSearchQuery('Audi Bumper');
    expect(audi.parsed.make).toBe('Audi');
    expect(audi.parsed.freeText).toBe('bumper');
    expect(audi.parsed.matchText).toBe('audi bumper');
    expect(jsonOf(audi.query)).toContain('audi bumper');

    // Adding the model must change the query, not produce an identical one.
    const q7 = buildSearchQuery('Audi Q7 bumper');
    expect(jsonOf(q7.query)).not.toEqual(jsonOf(audi.query));
  });

  it('strips stopwords so they never become required terms', () => {
    // "for" left in made "front bumper for 2018 Accord" match "FEBEST front
    // brake caliper repair kit (set for one side)" on front+for.
    const parsed = buildSearchQuery('front bumper for 2018 Accord').parsed;
    expect(parsed.matchText.split(' ')).not.toContain('for');
    expect(parsed.matchText).toBe('front bumper accord');
  });

  it('requires all terms of a 3-word query so adding a term narrows', () => {
    // With "2<75%", "Audi Q7 bumper" required only 2 of 3 terms and returned
    // 6,665 results — MORE than "Audi Bumper" at 2,315. Adding a term must
    // never widen the result set.
    expect(jsonOf(buildSearchQuery('Audi Q7 bumper').query)).toContain(
      String.raw`"minimum_should_match":"3<75%"`,
    );
  });

  it('drops years from the match text so range fitment still matches', () => {
    // A bumper listed as fitting 2015-2020 has no "2018" in its title.
    const parsed = buildSearchQuery('front bumper for 2018 Accord').parsed;
    expect(parsed.year).toBe(2018);
    expect(parsed.matchText).not.toContain('2018');
    expect(parsed.matchText).toContain('accord');
    expect(parsed.matchText).toContain('bumper');
  });

  it('boosts vehicle context without filtering on it', () => {
    // 56 % of the catalogue has no fitment data — a hard filter would
    // destroy recall.
    const { query } = buildSearchQuery('2019 toyota corolla camera');
    const bool = query.function_score.query.bool;
    const contextNames = Object.keys(namedClauses(bool.should));
    expect(contextNames).toEqual(expect.arrayContaining(['make', 'model', 'year']));
    expect(jsonOf(bool.filter)).not.toContain('"makes"');
  });

  it('uses the parsed side as a boost ("LH headlight")', () => {
    const { query, parsed } = buildSearchQuery('LH headlight');
    expect(parsed.side).toBe('LEFT');
    expect(Object.keys(namedClauses(query))).toContain('side');
  });
});

describe('buildFilters', () => {
  it('ANDs across dimensions and ORs within one', () => {
    const filters = buildFilters({ brand: ['Bosch', 'Denso'], category: ['Engine'] });
    expect(filters).toEqual(
      expect.arrayContaining([
        { terms: { brand: ['Bosch', 'Denso'] } },
        { terms: { category: ['Engine'] } },
      ]),
    );
  });

  it('always requires at least one buyer-visible offer', () => {
    expect(jsonOf(buildFilters({}))).toContain('offers.sellerId');
  });

  it('constrains condition and price against the same offer', () => {
    // An `object` mapping would let a NEW offer at 900 satisfy
    // {condition:NEW, price<100} together with a USED offer at 50.
    const filters = buildFilters({ condition: ['NEW'], priceMax: 100 });
    const nested = filters.filter((f: any) => f.nested?.path === 'offers');
    expect(nested.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores empty filter arrays', () => {
    expect(buildFilters({ brand: [], category: [] })).toEqual(buildFilters({}));
  });
});

describe('buildSort', () => {
  it('always ends with a deterministic tie-break', () => {
    for (const sort of ['relevance', 'price_asc', 'price_desc', 'newest'] as const) {
      const clauses = buildSort(sort, true);
      expect(clauses[clauses.length - 1]).toEqual({ id: { order: 'asc' } });
    }
  });

  it('falls back to a stable feed when relevance has no query', () => {
    expect(jsonOf(buildSort('relevance', false))).not.toContain('_score');
    expect(jsonOf(buildSort('relevance', true))).toContain('_score');
  });

  it('puts missing prices last in both directions', () => {
    expect(jsonOf(buildSort('price_asc', true))).toContain('"missing":"_last"');
    expect(jsonOf(buildSort('price_desc', true))).toContain('"missing":"_last"');
  });
});

describe('robustness', () => {
  it('builds a valid query for an empty search', () => {
    const { query } = buildSearchQuery(undefined);
    expect(query.function_score.query.bool.must[0]).toEqual({ match_all: {} });
  });

  it('does not throw on adversarial input', () => {
    expect(() => buildSearchQuery('*'.repeat(400))).not.toThrow();
    expect(() => buildSearchQuery('a'.repeat(3000))).not.toThrow();
    expect(() => buildSearchQuery('"; DROP TABLE parts; --')).not.toThrow();
  });

  it('never interpolates the raw query into a script or regex clause', () => {
    const body = jsonOf(buildSearchQuery('*/x{1,999999}').query);
    expect(body).not.toContain('"script"');
    expect(body).not.toContain('"regexp"');
    expect(body).not.toContain('"wildcard"');
  });
});
