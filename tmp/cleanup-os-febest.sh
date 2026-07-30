#!/bin/bash
# Find and delete all FEBEST parts from Salvage/Blackline in OpenSearch
OS="http://opensearch:9200"

# Search for parts with FEBEST in title that have Salvage or Blackline offers
RESPONSE=$(curl -s "${OS}/canonical_parts/_search" -H "Content-Type: application/json" -d '{
  "query": {
    "bool": {
      "must": [
        {"match": {"title": "FEBEST"}}
      ],
      "should": [
        {"term": {"offers.sellerName": "Salvage Auto Parts"}},
        {"term": {"offers.sellerName": "Blackline Auto Parts"}}
      ],
      "minimum_should_match": 1
    }
  },
  "_source": ["id", "title"],
  "size": 200
}')

echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
hits = d.get('hits', {}).get('hits', [])
print(f'Found {len(hits)} stale FEBEST docs in OpenSearch')
for h in hits:
    print(h['_source']['id'])
"

# Delete each one
for ID in $(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for h in d.get('hits', {}).get('hits', []):
    print(h['_source']['id'])
"); do
  RESULT=$(curl -s -X DELETE "${OS}/canonical_parts/_doc/${ID}")
  echo "Deleted ${ID}: $(echo $RESULT | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result","?"))')"
done

echo "Done. Checking remaining..."
COUNT=$(curl -s "${OS}/canonical_parts/_count" -H "Content-Type: application/json" -d '{
  "query": {
    "bool": {
      "must": [{"match": {"title": "FEBEST"}}],
      "should": [
        {"term": {"offers.sellerName": "Salvage Auto Parts"}},
        {"term": {"offers.sellerName": "Blackline Auto Parts"}}
      ],
      "minimum_should_match": 1
    }
  }
}')
echo "Remaining FEBEST+Salvage/Blackline in OpenSearch: $COUNT"
