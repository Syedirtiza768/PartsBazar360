#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)
sudo docker exec "$CID" node -e '
const {Client}=require("@opensearch-project/opensearch");
const c=new Client({node:process.env.OPENSEARCH_URL||"http://opensearch:9200"});
(async()=>{
  const id="6327c7ae-aa3e-4e8d-b236-191fa9640204";
  const r=await c.get({index:"canonical_parts",id});
  const s=r.body._source;
  console.log(JSON.stringify({
    id:s.id,
    mpn:s.manufacturerPartNumber,
    images:s.imageUrls,
    compat:Array.isArray(s.compatibility)?s.compatibility.length:null,
    listingUrl:s.listingUrl
  },null,2));
})().catch(e=>{console.error(e);process.exit(1)});
'
echo '---RATE---'
# rough ok count from log
echo -n 'ok='; grep -c '"status":"ok"' /home/ubuntu/febest-enrich.log || true
tail -n 2 /home/ubuntu/febest-enrich.log
