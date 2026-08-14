/**
 * Captures the OpenSearch body `browseParts` actually emits.
 *
 * The regression these lock down: the descriptive `multi_match` had no
 * `minimum_should_match`, and multi_match defaults to `operator: or`. Live,
 * that made "Audi bumper" return the union of both terms (10,932 hits against
 * an intersection of ~208), made "Audi Q7 bumper" return MORE results than
 * "Audi bumper" (11,063), and made "zzzz bumper" identical to "bumper" (1,934)
 * because an unmatchable token was simply ignored.
 */
import { OpenSearchService } from './opensearch.service';

type Captured = { body: any };

/** Stub client that records every search body and returns a fixed hit count. */
function stubService(totalPerCall: number[], aggregations: any = {}) {
  const calls: Captured[] = [];
  let call = 0;
  const service = new OpenSearchService();
  (service as any).client = {
    search: async ({ body }: any) => {
      calls.push({ body });
      const total = totalPerCall[Math.min(call, totalPerCall.length - 1)];
      call++;
      return {
        body: {
          hits: { total: { value: total, relation: 'eq' }, hits: [] },
          aggregations,
        },
      };
    },
  };
  return { service, calls };
}

/** The descriptive multi_match clause inside the emitted query. */
function multiMatchOf(body: any) {
  const should = body.query.bool.must[0].bool.should;
  return should.find((clause: any) => clause.multi_match)?.multi_match;
}

describe('browseParts query construction', () => {
  it('requires every term of a short query', async () => {
    const { service, calls } = stubService([500]);
    await service.browseParts({ q: 'Audi bumper' });

    const mm = multiMatchOf(calls[0].body);
    // "3<75%" = require all terms at 3 or fewer. A bare "75%" rounds down and
    // would still let a two-token query match on one token.
    expect(mm.minimum_should_match).toBe('3<75%');
  });

  it('keeps part-number clauses outside the msm guard', async () => {
    const { service, calls } = stubService([500]);
    await service.browseParts({ q: '8R0807453C' });

    const should = calls[0].body.query.bool.must[0].bool.should;
    const numberClause = should.find(
      (c: any) => c.term?.['normalizedPartNumbers.keyword'],
    );
    // A pasted part number must still resolve on its own, so the outer bool
    // stays at minimum_should_match: 1.
    expect(numberClause).toBeDefined();
    expect(calls[0].body.query.bool.must[0].bool.minimum_should_match).toBe(1);
  });

  it('does not retry when strict matching finds enough', async () => {
    const { service, calls } = stubService([500]);
    const result = await service.browseParts({ q: 'Audi bumper' });

    expect(calls).toHaveLength(1);
    expect(result.relaxed).toBe(false);
  });

  it('does not relax a thin but non-empty result set', async () => {
    // A pasted part number legitimately returns one hit. Labelling that
    // "no exact matches — showing related parts" mislabels a perfect match,
    // which is exactly what a threshold-based retry did on 8R0807453C.
    const { service, calls } = stubService([1, 900]);
    const result = await service.browseParts({ q: '8R0807453C' });

    expect(calls).toHaveLength(1);
    expect(result.relaxed).toBe(false);
    expect(result.total).toBe(1);
  });

  it('retries relaxed only when strict matching finds nothing at all', async () => {
    // Strict returns 0 (catalogue genuinely lacks the part), relaxed finds 40.
    const { service, calls } = stubService([0, 40]);
    const result = await service.browseParts({
      q: 'front bumper for 2018 Audi Q7',
    });

    expect(calls).toHaveLength(2);
    expect(multiMatchOf(calls[0].body).minimum_should_match).toBe('3<75%');
    expect(multiMatchOf(calls[1].body).minimum_should_match).toBe('2<50%');
    // Surfaced so the UI can say "related parts", not "matches".
    expect(result.relaxed).toBe(true);
    expect(result.total).toBe(40);
  });

  it('relaxes on deep pages too, so page 2 agrees with page 1', async () => {
    // Regression: relaxation used to run only on page 1. Page 1 reported the
    // relaxed total (e.g. 7,917 "related parts") while page 2 re-ran the
    // strict query, returned total 0, and rendered "No matching parts".
    const { service, calls } = stubService([0, 40]);
    const result = await service.browseParts({ q: 'xyzzy brake pad', page: 2 });

    expect(calls).toHaveLength(2);
    expect(multiMatchOf(calls[0].body).minimum_should_match).toBe('3<75%');
    expect(multiMatchOf(calls[1].body).minimum_should_match).toBe('2<50%');
    expect(result.relaxed).toBe(true);
    expect(result.total).toBe(40);
  });

  it('keeps strict matching on deep pages when strict results exist', async () => {
    const { service, calls } = stubService([500]);
    const result = await service.browseParts({ q: 'Audi bumper', page: 3 });

    expect(calls).toHaveLength(1);
    expect(result.relaxed).toBe(false);
  });

  it('appends a unique id.keyword tiebreak to every sort order', async () => {
    // Without a unique final tiebreak, ties at a page boundary can swap order
    // across segment merges — duplicating or dropping items between pages.
    // Must be id.keyword: the legacy index maps id as text, and sorting a
    // text field throws search_phase_execution_exception (verified live
    // 2026-08-14 — "brake pad" returned 0 results until this was fixed).
    for (const sort of ['relevance', 'newest', 'price_asc', 'price_desc'] as const) {
      const { service, calls } = stubService([100]);
      await service.browseParts({ q: 'brake pad', sort });
      const clause = calls[0].body.sort;
      expect(clause[clause.length - 1]).toEqual({ 'id.keyword': { order: 'asc' } });
    }
  });

  it('reports the true total — never a fake 0 — beyond the result window', async () => {
    // Regression: pages past max_result_window used to return total 0, making
    // a stale/hand-edited deep URL claim the whole catalog was empty.
    const { service, calls } = stubService([107565]);
    const result = await service.browseParts({ page: 5000, limit: 24 });

    // One cheap size:0 count query, no hits requested.
    expect(calls).toHaveLength(1);
    expect(calls[0].body.size).toBe(0);
    expect(calls[0].body.from).toBeUndefined();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(107565);
    expect(result.pageOutOfRange).toBe(true);
  });

  it('reports the relaxed total beyond the result window for no-match queries', async () => {
    const { service, calls } = stubService([0, 40]);
    const result = await service.browseParts({ q: 'xyzzy brake pad', page: 5000, limit: 24 });

    expect(calls).toHaveLength(2);
    expect(result.total).toBe(40);
    expect(result.relaxed).toBe(true);
    expect(result.pageOutOfRange).toBe(true);
  });

  it('emits no query clause for a filter-only browse', async () => {
    const { service, calls } = stubService([500]);
    await service.browseParts({ category: 'Body' });

    expect(calls[0].body.query.bool.must[0]).toEqual({ match_all: {} });
    expect(calls).toHaveLength(1);
  });

  it('omits facet aggregations for count-only previews', async () => {
    const { service, calls } = stubService([36790]);
    const result = await service.browseParts({
      partType: 'AFTERMARKET',
      limit: 1,
      includeFacets: false,
    });

    expect(calls[0].body.aggs).toBeUndefined();
    expect(result.total).toBe(36790);
    expect(result.facets).toEqual({
      brands: [],
      categories: [],
      categoryGroups: [],
      makes: [],
      partTypes: [],
      conditions: [],
      sourceTags: [],
    });
  });

  it('clubs spelling and case variants into canonical facet buckets', async () => {
    const { service } = stubService([100], {
      brands: {
        names: {
          buckets: [
            { key: 'Mercedes', doc_count: 10 },
            { key: 'MERCEDES BENZ', doc_count: 20 },
            { key: 'Mercedes-Benz', doc_count: 30 },
            { key: 'MEYLE-1006100011', doc_count: 1 },
            { key: 'MEYLE', doc_count: 1291 },
            { key: 'REMSA-1379.00', doc_count: 1 },
            { key: 'REMSA', doc_count: 48 },
          ],
        },
      },
      makes: {
        names: {
          buckets: [
            { key: 'Toyota', doc_count: 40 },
            { key: 'TOYOTA', doc_count: 5 },
            { key: 'PEUGEOT/CITROEN', doc_count: 12 },
          ],
        },
      },
    });

    const result = await service.browseParts({});

    expect(result.facets.brands).toContainEqual({
      name: 'Mercedes-Benz',
      count: 60,
    });
    expect(result.facets.makes).toContainEqual({ name: 'Toyota', count: 45 });
    expect(result.facets.brands).toContainEqual({ name: 'MEYLE', count: 1292 });
    expect(result.facets.brands).toContainEqual({ name: 'REMSA', count: 49 });
    expect(result.facets.makes).toContainEqual({ name: 'Peugeot', count: 12 });
    expect(result.facets.makes).toContainEqual({ name: 'Citroen', count: 12 });
  });

  it('expands canonical selections to legacy indexed aliases', async () => {
    const { service, calls } = stubService([100]);
    await service.browseParts({
      brand: 'Volkswagen',
      make: 'Mercedes-Benz',
    });

    const filters = calls[0].body.query.bool.filter;
    const brandTerms = filters.find((value: any) => value.terms?.['brand.keyword'])
      .terms['brand.keyword'];
    const makeTerms = filters.find((value: any) => value.terms?.['makes.keyword'])
      .terms['makes.keyword'];

    expect(brandTerms).toEqual(expect.arrayContaining(['Volkswagen', 'VW', 'volkwagen']));
    expect(makeTerms).toEqual(
      expect.arrayContaining(['Mercedes-Benz', 'Mercedes', 'mercedes benz']),
    );
  });
});
