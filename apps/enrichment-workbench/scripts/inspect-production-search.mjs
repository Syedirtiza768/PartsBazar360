import { Client } from '@opensearch-project/opensearch';
const c = new Client({ node: process.env.OPENSEARCH_URL || 'http://opensearch:9200' });
const queries = {
  brandKeyword: { query: { term: { 'brand.keyword': 'FEBI' } } },
  brandMatch: { query: { match: { brand: 'FEBI' } } },
  brandTerm: { query: { term: { brand: 'FEBI' } } },
  titleKeyword: { query: { query_string: { query: 'FEBI' } } },
  offersExists: { query: { exists: { field: 'offers.sellerId' } } },
  febiOffersExists: { query: { bool: { filter: [{ term: { 'brand.keyword': 'FEBI' } }, { exists: { field: 'offers.sellerId' } }] } } },
};
const out = {};
for (const [name, body] of Object.entries(queries)) {
  try { const r = await c.count({ index: 'canonical_parts', body }); out[name] = r.body ?? r; }
  catch (e) { out[name] = { error: e.message }; }
}
const sample = await c.search({ index: 'canonical_parts', body: { size: 2, query: { match: { brand: 'FEBI' } }, _source: ['id', 'brand', 'title', 'manufacturerPartNumber', 'fitmentStatus', 'compatibility', 'offers'] } });
out.sample = (sample.body ?? sample).hits?.hits?.map((h) => ({ id: h._id, source: h._source }));
console.log(JSON.stringify(out));
