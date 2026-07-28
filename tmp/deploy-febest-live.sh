#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
git pull --ff-only origin main
echo "HEAD=$(git rev-parse --short HEAD)"
sudo docker compose up -d --build api
for i in $(seq 1 40); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 8 ]; then
    sudo docker compose logs --tail=40 api
    exit 1
  fi
  sleep 5
done
CID=$(sudo docker compose ps -q api)
# Prefer an MPN that was NOT bulk-enriched (later alphabetically), e.g. MZAB
PART_JSON=$(sudo docker exec -w /app "$CID" node -e '
const {PrismaClient}=require("@prisma/client");
const {PrismaPg}=require("@prisma/adapter-pg");
const p=new PrismaClient({adapter:new PrismaPg(process.env.DATABASE_URL)});
(async()=>{
  let part=await p.canonicalPart.findFirst({
    where:{ manufacturerPartNumber: "MZAB-B2500L" },
    select:{ id:true, manufacturerPartNumber:true, brand:true }
  });
  if(!part){
    part=await p.canonicalPart.findFirst({
      where:{ brand: "FEBEST", manufacturerPartNumber: { startsWith: "MZAB" } },
      select:{ id:true, manufacturerPartNumber:true, brand:true },
      orderBy:{ manufacturerPartNumber: "asc" }
    });
  }
  console.log(JSON.stringify(part));
  await p.$disconnect();
})().catch(e=>{console.error(String(e)); process.exit(1)});
')
echo "PART=$PART_JSON"
ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$PART_JSON")
echo "Fetching live PDP $ID"
sudo docker exec "$CID" wget -qO- "http://127.0.0.1:3001/search/parts/$ID" > /tmp/febest-live-part.json
node -e '
const j=require("/tmp/febest-live-part.json");
console.log(JSON.stringify({
  mpn:j.manufacturerPartNumber,
  enrichmentLive:j.enrichmentLive,
  enrichmentSource:j.enrichmentSource,
  listingUrl:j.listingUrl,
  images:(j.imageUrls||[]).slice(0,2),
  compatRows:(j.compatibilityTable||j.compatibility||[]).length,
  sampleCompat:(j.compatibilityTable||j.compatibility||[]).slice(0,2),
},null,2));
'
