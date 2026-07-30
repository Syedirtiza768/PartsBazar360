const OS = 'http://opensearch:9200';
const INDEX = 'canonical_parts';

async function run() {
  // Find all docs in OpenSearch that have FEBEST in title AND have Salvage/Blackline offers
  let totalDeleted = 0;
  let scrollId = null;
  
  // Use search_after for pagination
  const searchBody = {
    query: {
      bool: {
        must: [
          { match_phrase: { title: 'FEBEST' } }
        ],
        should: [
          { nested: { path: 'offers', query: { term: { 'offers.sellerName': 'Salvage Auto Parts' } } } },
          { nested: { path: 'offers', query: { term: { 'offers.sellerName': 'Blackline Auto Parts' } } } }
        ],
        minimum_should_match: 1
      }
    },
    _source: ['id', 'title'],
    size: 100
  };

  const searchRes = await fetch(`${OS}/${INDEX}/_search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(searchBody),
  });
  const data = await searchRes.json();
  const hits = data.hits?.hits || [];
  
  console.log(`Found ${hits.length} stale FEBEST+Salvage/Blackline docs in OpenSearch`);
  
  for (const hit of hits) {
    const id = hit._source.id;
    const title = hit._source.title;
    const delRes = await fetch(`${OS}/${INDEX}/doc/${id}`, { method: 'DELETE' });
    const delData = await delRes.json();
    console.log(`DELETED: ${id} - ${title} (${delData.result})`);
    totalDeleted++;
  }
  
  console.log(`\nTotal deleted: ${totalDeleted}`);
  
  // Also check for docs where the CanonicalPart itself no longer exists in postgres
  // (the reindex was interrupted, so some old docs may remain)
  // We can check by looking at the total count
  const countRes = await fetch(`${OS}/${INDEX}/_count`);
  const countData = await countRes.json();
  console.log(`Total docs in OpenSearch: ${countData.count}`);
}

run().catch(console.error);
