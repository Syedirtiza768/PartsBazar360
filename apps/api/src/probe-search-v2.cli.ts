/**
 * Acceptance probe for the v2 search index.
 *
 * Runs the exact queries recorded as failing in docs/SEARCH_PHASE1_AUDIT.md §3
 * against the new index with the new query builder, so the before/after
 * comparison is measured rather than asserted (brief §29).
 *
 *   node dist/src/probe-search-v2.cli.js
 *   PROBE_INDEX=canonical_parts_v2 node dist/src/probe-search-v2.cli.js
 */
import 'dotenv/config';
import { Client } from '@opensearch-project/opensearch';
import { buildSearchQuery } from './modules/search/query/relevance.builder';
import {
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from './modules/search/index/search-index.schema';

/** query → what the production system returned, from the audit. */
const PROBES: Array<{ q: string; before: string; expect: string }> = [
  { q: '8640112020', before: '3 · correct', expect: 'correct part first' },
  { q: '86401-12020', before: '5 · WRONG', expect: 'correct part first' },
  { q: '86401 12020', before: '5 · WRONG', expect: 'correct part first' },
  { q: '86401/12020', before: '5 · WRONG', expect: 'correct part first' },
  { q: '86401', before: '0 results', expect: 'partial match works' },
  { q: 'A 221 820 02 64', before: '3742 · WRONG', expect: 'correct part first' },
  { q: 'a2218200264', before: '4 · correct', expect: 'correct part first' },
  { q: 'alternator', before: '424', expect: 'baseline' },
  { q: 'altrenator', before: '0 results', expect: 'typo tolerated' },
  { q: 'tail light', before: '983', expect: 'parity with taillight' },
  { q: 'taillight', before: '22', expect: 'parity with tail light' },
  { q: '2019 toyota corolla lane camera', before: '5834 · noisy', expect: 'far fewer, precise' },
  { q: 'LH headlight', before: '2807 · wrong parts', expect: 'left-side headlights' },
];

async function main() {
  const index = process.env.PROBE_INDEX || physicalIndexName(SEARCH_INDEX_VERSION);
  const client = new Client({
    node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
  });

  console.log(`\nProbing index: ${index}\n`);
  console.log(
    'query'.padEnd(34) +
      'before'.padEnd(18) +
      'after'.padEnd(10) +
      'ms'.padEnd(6) +
      'top result',
  );
  console.log('-'.repeat(140));

  for (const probe of PROBES) {
    const { query, sort } = buildSearchQuery(probe.q, {}, 'relevance');
    const startedAt = Date.now();
    let total = 0;
    let top = '';
    try {
      const response: any = await client.search({
        index,
        body: { size: 3, track_total_hits: true, query, sort } as any,
      });
      total = Number(response.body.hits.total?.value ?? 0);
      const hit = response.body.hits.hits[0];
      top = hit
        ? `${String(hit._source.title ?? '').slice(0, 58)} [${hit._source.manufacturerPartNumber ?? '-'}]`
        : '(none)';
    } catch (error: any) {
      top = `ERROR ${error?.message?.slice(0, 60)}`;
    }
    const ms = Date.now() - startedAt;

    console.log(
      probe.q.padEnd(34) +
        probe.before.padEnd(18) +
        String(total).padEnd(10) +
        String(ms).padEnd(6) +
        top,
    );
  }

  // Latency sample against the brief's §21 targets.
  const timings: number[] = [];
  for (let i = 0; i < 30; i++) {
    const { query, sort } = buildSearchQuery(PROBES[i % PROBES.length].q, {}, 'relevance');
    const startedAt = Date.now();
    await client.search({ index, body: { size: 24, track_total_hits: true, query, sort } as any });
    timings.push(Date.now() - startedAt);
  }
  timings.sort((a, b) => a - b);
  const pct = (p: number) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
  console.log(
    `\nlatency over ${timings.length} queries — p50 ${pct(0.5)}ms · p95 ${pct(0.95)}ms · p99 ${pct(0.99)}ms`,
  );
  console.log('targets (brief §21): p50 <150ms · p95 <400ms · p99 <800ms');

  process.exit(0);
}

main().catch((error) => {
  console.error('probe failed', error);
  process.exit(1);
});
