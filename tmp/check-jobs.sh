#!/bin/sh
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep -E "seed-salvagea|enrich-febest" | grep -v grep || true'
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "SELECT s.name, COUNT(*) FILTER (WHERE o.status='ACTIVE') AS active FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.name IN ('Salvage Auto Parts','Superior Auto Parts') GROUP BY 1;"
