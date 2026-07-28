const { Client } = require('pg');

async function main() {
  // Try direct PostgreSQL connection
  const client = new Client({
    host: 'localhost',
    port: 51214,
    user: 'postgres',
    password: 'postgres',
    database: 'template1',
    connection_timeout: 5,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL on port 51214');
    
    const res = await client.query("SELECT COUNT(*)::int as count FROM \"SellerOffer\" WHERE price >= 300");
    console.log('Listings with price >= $300:', res.rows[0].count);

    const totalRes = await client.query("SELECT COUNT(*)::int as count FROM \"SellerOffer\"");
    console.log('Total listings:', totalRes.rows[0].count);

    const activeRes = await client.query("SELECT COUNT(*)::int as count FROM \"SellerOffer\" WHERE price >= 300 AND status = 'ACTIVE'");
    console.log('Active listings with price >= $300:', activeRes.rows[0].count);

    // Price distribution
    const dist = await client.query(`
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
    `);
    console.log('\nPrice distribution:');
    dist.rows.forEach(r => console.log('  $' + r.range + ': ' + r.count));
  } catch (err) {
    console.error('Port 51214 failed:', err.message);
    
    // Try port 51213
    const client2 = new Client({
      host: 'localhost',
      port: 51213,
      user: 'postgres',
      password: 'postgres',
      database: 'template1',
      connection_timeout: 5,
    });
    try {
      await client2.connect();
      console.log('Connected on port 51213');
      const res = await client2.query("SELECT COUNT(*)::int as count FROM \"SellerOffer\" WHERE price >= 300");
      console.log('Listings with price >= $300:', res.rows[0].count);
    } catch (err2) {
      console.error('Port 51213 also failed:', err2.message);
    } finally {
      await client2.end();
    }
  } finally {
    await client.end();
  }
}

main().catch(console.error);
