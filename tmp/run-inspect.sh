#!/bin/bash
set -eu
tr -d '\r' < /tmp/inspect-offer-fks.sql > /tmp/inspect-offer-fks.lf.sql
docker cp /tmp/inspect-offer-fks.lf.sql partsbazar360-postgres-1:/tmp/inspect-offer-fks.sql

# cancel stuck wipe if still running
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND query ILIKE '%DELETE FROM \"SellerOffer\"%' AND pid <> pg_backend_pid();"

sleep 2
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/inspect-offer-fks.sql
