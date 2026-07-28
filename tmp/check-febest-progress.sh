#!/bin/bash
set -euo pipefail
echo '=== PROCESS ==='
ps aux | grep 'enrich-febest-from-website' | grep -v grep || echo 'enrich process not running'
echo '=== LOG TAIL ==='
tail -n 12 /home/ubuntu/febest-enrich.log || true
echo '=== COUNTS ==='
echo -n 'ok_lines='; grep -c '"status":"ok"' /home/ubuntu/febest-enrich.log || true
echo -n 'fail_lines='; grep -c '"event":"error"' /home/ubuntu/febest-enrich.log || true
echo -n 'not_found_lines='; grep -c '"status":"not_found"' /home/ubuntu/febest-enrich.log || true
echo -n 'skipped_lines='; grep -c '"status":"skipped"' /home/ubuntu/febest-enrich.log || true
echo '=== STATE FILE ==='
CID=$(cd /home/ubuntu/PartsBazar360 && sudo docker compose ps -q api)
sudo docker exec "$CID" sh -c 'if [ -f /tmp/febest-enrich-progress.json ]; then node -e "const s=require(\"/tmp/febest-enrich-progress.json\"); console.log(JSON.stringify({updatedAt:s.updatedAt,ok:s.ok,fail:s.fail,skipped:s.skipped,notFound:s.notFound,done: (s.done||[]).length},null,2));"; else echo no_state_file; fi'
echo '=== DB SAMPLE ==='
sudo docker exec -w /app "$CID" node -e '
const {PrismaClient}=require("@prisma/client");
const {PrismaPg}=require("@prisma/adapter-pg");
const p=new PrismaClient({adapter:new PrismaPg(process.env.DATABASE_URL)});
(async()=>{
  const seller="seed-febest-inventory-supplier";
  const total=await p.sellerOffer.groupBy({by:["canonicalPartId"],where:{sellerId:seller}});
  const withImages=await p.$queryRaw`
    SELECT COUNT(DISTINCT so."canonicalPartId")::int AS c
    FROM "SellerOffer" so
    JOIN "CanonicalPart" cp ON cp.id = so."canonicalPartId"
    WHERE so."sellerId" = ${seller}
      AND EXISTS (
        SELECT 1 FROM unnest(cp."imageUrls") u
        WHERE u LIKE '\''%static.febest.de%'\''
      )`;
  const withCompat=await p.$queryRaw`
    SELECT COUNT(DISTINCT so."canonicalPartId")::int AS c
    FROM "SellerOffer" so
    JOIN "CanonicalPart" cp ON cp.id = so."canonicalPartId"
    WHERE so."sellerId" = ${seller}
      AND cp.compatibility IS NOT NULL
      AND jsonb_typeof(cp.compatibility) = '\''array'\''
      AND jsonb_array_length(cp.compatibility) > 0`;
  console.log(JSON.stringify({
    totalParts: total.length,
    withFebestImages: withImages[0].c,
    withCompatibility: withCompat[0].c,
    pctImages: Math.round(1000 * withImages[0].c / total.length) / 10
  }, null, 2));
  await p.$disconnect();
})().catch(e=>{console.error(e); process.exit(1)});
'
