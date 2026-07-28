#!/bin/bash
set -eu
echo "==== OS docs: offers missing sellerName or price ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"no_seller\":{\"filter\":{\"bool\":{\"must_not\":[{\"exists\":{\"field\":\"offers.sellerName\"}}]}},\"aggs\":{\"sample\":{\"top_hits\":{\"size\":3,\"_source\":[\"id\",\"title\",\"offers\"]}}}},\"no_price\":{\"filter\":{\"bool\":{\"must_not\":[{\"exists\":{\"field\":\"offers.price\"}}]}}}}}"'
echo
echo "==== OS: count docs with empty offers array ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"query\":{\"bool\":{\"must_not\":[{\"exists\":{\"field\":\"offers.sellerId\"}}]}}}"'
echo
echo "==== Sample OS doc offers fields ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":2,\"_source\":[\"id\",\"title\",\"offers\",\"minPrice\"]}"'
