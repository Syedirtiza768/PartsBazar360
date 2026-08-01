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
function stubService(totalPerCall: number[]) {
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
          aggregations: {},
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

  it('retries relaxed when strict matching finds almost nothing', async () => {
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

  it('does not retry on deep pages, so pagination stays consistent', async () => {
    const { service, calls } = stubService([0, 40]);
    const result = await service.browseParts({ q: 'Audi bumper', page: 3 });

    expect(calls).toHaveLength(1);
    expect(result.relaxed).toBe(false);
  });

  it('emits no query clause for a filter-only browse', async () => {
    const { service, calls } = stubService([500]);
    await service.browseParts({ category: 'Body' });

    expect(calls[0].body.query.bool.must[0]).toEqual({ match_all: {} });
    expect(calls).toHaveLength(1);
  });
});
