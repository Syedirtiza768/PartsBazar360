#!/bin/bash
# Helper script to check image URLs from the API response

cd ~/PartsBazar360 || exit 1

# Fetch part data
docker compose exec -T api curl -s http://localhost:3001/search/parts/0a4583af-44cd-44bc-a459-4cd17f2df80d > /tmp/part.json

# Extract and print imageUrls
echo "=== imageUrls ==="
python3 << 'PYEOF'
import json
d = json.load(open('/tmp/part.json'))
for i, url in enumerate(d.get('imageUrls', [])):
    print(f"{i}: {url}")
print(f"\nTotal: {len(d.get('imageUrls', []))}")
print(f"locationDiagramUrl: {d.get('locationDiagramUrl')}")
print(f"infographicUrl: {d.get('infographicUrl')}")
PYEOF
