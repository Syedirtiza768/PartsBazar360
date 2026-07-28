const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    // Count ALL listings (active + inactive) >= 300
    const allResult = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "SellerOffer" WHERE price >= 300
    `;
    console.log('All listings with price >= 300:', allResult[0].count);

    // Count ACTIVE listings >= 300
    const activeResult = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "SellerOffer" WHERE price >= 300 AND status = 'ACTIVE'
    `;
    console.log('Active listings with price >= 300:', activeResult[0].count);

    // Total listings for context
    const totalResult = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "SellerOffer"
    `;
    console.log('Total listings in DB:', totalResult[0].count);

    // Price distribution
    const dist = await prisma.$queryRaw`
      SELECT 
        CASE 
          WHEN price < 50 THEN '0-49'
          WHEN price < 100 THEN '50-99'
          WHEN price < 200 THEN '100-199'
          WHEN price < 300 THEN '200-299'
          WHEN price < 500 THEN '300-499'
          WHEN price < 1000 THEN '500-999'
          ELSE '1000+'
        END as range,
        COUNT(*)::int as count
      FROM "SellerOffer"
      GROUP BY 1
      ORDER BY MIN(price)
    `;
    console.log('\nPrice distribution:');
    dist.forEach(r => console.log(`  ${r.range}: ${r.count}`));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
