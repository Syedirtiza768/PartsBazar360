#!/bin/bash
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE weight IS NOT NULL AND weight > 0) AS has_weight, COUNT(*) FILTER (WHERE weight IS NULL OR weight <= 0) AS missing_or_zero FROM \"CanonicalPart\";"