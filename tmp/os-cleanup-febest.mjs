const OS = 'http://opensearch:9200';
const INDEX = 'canonical_parts';

async function run() {
  // Find all docs with FEBEST in title
  const searchRes = await fetch(`${OS}/${INDEX}/_search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: { match_phrase: { title: 'FEBEST' } },
      _source: ['id', 'title', 'offers.sellerName'],
      size: 200,
    }),
  });
  const data = await searchRes.json();
  const hits = data.hits?.hits || [];
  
  console.log(`Found ${hits.length} FEBEST docs in OpenSearch`);
  
  let deleted = 0;
  for (const hit of hits) {
    const id = hit._source.id;
    const title = hit._source.title;
    const sellerNames = (hit._source.offers || []).map(o => o.sellerName);
    const isSalvage = sellerNames.some(s => s && (s.includes('Salvage') || s.includes('Blackline')));
    
    if (isSalvage) {
      const delRes = await fetch(`${OS}/${INDEX}/doc/${id}`, { method: 'DELETE' });
      const delData = await delRes.json();
      console.log(`DELETED: ${id} - ${title} (result: ${delData.result})`);
      deleted++;
    } else {
      console.log(`KEPT: ${id} - ${title} (sellers: ${sellerNames.join(', ')})`);
    }
  }
  
  console.log(`\nDeleted ${deleted} FEBEST+Salvage/Blackline docs from OpenSearch`);
  
  // Verify
  const countRes = await fetch(`${OS}/${INDEX}/_count`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: { match_phrase: { title: 'FEBEST' } },
    }),
  });
  const countData = await countRes.json();
  console.log(`Remaining FEBEST docs in OpenSearch: ${countData.count}`);
}

run().catch(console.error);
