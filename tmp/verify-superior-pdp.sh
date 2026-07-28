#!/bin/bash
set -eu
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":1,\"query\":{\"bool\":{\"must\":[{\"term\":{\"brand.keyword\":\"FEBEST\"}},{\"term\":{\"offers.sellerName.keyword\":\"Superior Auto Parts\"}}]}},\"_source\":[\"id\",\"title\",\"manufacturerPartNumber\",\"offers\"]}"'
echo
ID=$(docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":1,\"query\":{\"bool\":{\"must\":[{\"term\":{\"brand.keyword\":\"FEBEST\"}},{\"term\":{\"offers.sellerName.keyword\":\"Superior Auto Parts\"}}]}},\"_source\":[\"id\"]}"' | python3 -c 'import sys,json; print(json.load(sys.stdin)["hits"]["hits"][0]["_id"])')
echo "PDP id=$ID"
docker exec partsbazar360-api-1 sh -lc "wget -qO- http://127.0.0.1:3001/search/parts/$ID" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("title")); print([(o["seller"]["name"] if o.get("seller") else o.get("sellerName"), o["status"] if "status" in o else "ACTIVE", o["price"]) for o in d.get("offers",[])])'
