import pg from 'pg';

// Connect directly to the local postgres (Prisma managed)
const pool = new pg.Pool({ 
  connectionString: 'postgresql://postgres:postgres@localhost:51214/template1?sslmode=disable',
  connectionTimeoutMillis: 5000
});

async function run() {
  try {
    const t = await pool.query('SELECT COUNT(*) as total FROM "CanonicalPart"');
    const e = await pool.query(`SELECT COUNT(*) as enriched FROM "CanonicalPart" WHERE "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}'`);
    const n = await pool.query(`SELECT COUNT(*) as not_enriched FROM "CanonicalPart" WHERE "itemSpecifics" IS NULL OR jsonb_typeof("itemSpecifics") != 'object' OR "itemSpecifics"::text = '{}'`);
    const r = await pool.query(`SELECT COUNT(*) as recent FROM "CanonicalPart" WHERE "updatedAt" > NOW() - INTERVAL '24 hours' AND "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}'`);

    console.log('=== Item Specifics Enrichment Status ===');
    console.log('Total CanonicalParts:', t.rows[0].total);
    console.log('Enriched (has itemSpecifics):', e.rows[0].enriched);
    console.log('Not enriched:', n.rows[0].not_enriched);
    const pct = t.rows[0].total > 0 ? ((e.rows[0].enriched / t.rows[0].total) * 100).toFixed(1) : 0;
    console.log('Coverage:', pct + '%');
    console.log('Updated last 24h:', r.rows[0].recent);

    const s = await pool.query(`SELECT id, title, "itemSpecifics", "updatedAt" FROM "CanonicalPart" WHERE "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}' ORDER BY "updatedAt" DESC LIMIT 5`);
    console.log('\nLatest 5 enriched:');
    for (const row of s.rows) {
      console.log(`  [${row.updatedAt?.toISOString()?.substring(0,19)}] ${row.title?.substring(0, 65)}`);
      const sp = row.itemSpecifics;
      console.log(`    partType=${sp.partType || '-'} | position=${sp.position || '-'} | vehicleSystem=${sp.vehicleSystem || '-'} | brandType=${sp.brandType || '-'}`);
    }

    // Breakdown by vehicle
    const v = await pool.query(`
      SELECT elem->>'make' as make, elem->>'model' as model, COUNT(DISTINCT cp.id) as parts,
        COUNT(DISTINCT CASE WHEN cp."itemSpecifics" IS NOT NULL AND jsonb_typeof(cp."itemSpecifics") = 'object' AND cp."itemSpecifics"::text != '{}' THEN cp.id END) as enriched
      FROM "CanonicalPart" cp
      JOIN "SellerOffer" so ON cp.id = so."canonicalPartId"
      JOIN "Seller" s ON so."sellerId" = s.id
      CROSS JOIN LATERAL jsonb_array_elements(cp.compatibility) elem
      WHERE so.status = 'ACTIVE' AND s."onboardingStatus" = 'ACTIVE' AND so.price > 0
        AND cp.compatibility IS NOT NULL AND jsonb_typeof(cp.compatibility) = 'array'
        AND elem->>'make' IN ('Toyota', 'BMW', 'Dodge')
      GROUP BY elem->>'make', elem->>'model'
      ORDER BY parts DESC
      LIMIT 15
    `);
    console.log('\nVehicle breakdown (target vehicles: Toyota/BMW/Dodge):');
    for (const row of v.rows) {
      const vPct = row.parts > 0 ? ((row.enriched / row.parts) * 100).toFixed(0) : 0;
      console.log(`  ${row.make} ${row.model}: ${row.enriched}/${row.parts} enriched (${vPct}%)`);
    }

    await pool.end();
  } catch(e) {
    console.error('Connection failed, trying port 51215...');
    await pool.end();
    const pool2 = new pg.Pool({ 
      connectionString: 'postgresql://postgres:postgres@localhost:51215/template1?sslmode=disable',
      connectionTimeoutMillis: 5000
    });
    const t = await pool2.query('SELECT COUNT(*) as total FROM "CanonicalPart"');
    const e = await pool2.query(`SELECT COUNT(*) as enriched FROM "CanonicalPart" WHERE "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}'`);
    const n = await pool2.query(`SELECT COUNT(*) as not_enriched FROM "CanonicalPart" WHERE "itemSpecifics" IS NULL OR jsonb_typeof("itemSpecifics") != 'object' OR "itemSpecifics"::text = '{}'`);
    const r = await pool2.query(`SELECT COUNT(*) as recent FROM "CanonicalPart" WHERE "updatedAt" > NOW() - INTERVAL '24 hours' AND "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}'`);
    console.log('=== Item Specifics Enrichment Status ===');
    console.log('Total CanonicalParts:', t.rows[0].total);
    console.log('Enriched (has itemSpecifics):', e.rows[0].enriched);
    console.log('Not enriched:', n.rows[0].not_enriched);
    const pct = t.rows[0].total > 0 ? ((e.rows[0].enriched / t.rows[0].total) * 100).toFixed(1) : 0;
    console.log('Coverage:', pct + '%');
    console.log('Updated last 24h:', r.rows[0].recent);
    const s = await pool2.query(`SELECT id, title, "itemSpecifics", "updatedAt" FROM "CanonicalPart" WHERE "itemSpecifics" IS NOT NULL AND jsonb_typeof("itemSpecifics") = 'object' AND "itemSpecifics"::text != '{}' ORDER BY "updatedAt" DESC LIMIT 5`);
    console.log('\nLatest 5 enriched:');
    for (const row of s.rows) {
      console.log(`  [${row.updatedAt?.toISOString()?.substring(0,19)}] ${row.title?.substring(0, 65)}`);
      const sp = row.itemSpecifics;
      console.log(`    partType=${sp.partType || '-'} | position=${sp.position || '-'} | vehicleSystem=${sp.vehicleSystem || '-'} | brandType=${sp.brandType || '-'}`);
    }
    const v = await pool2.query(`
      SELECT elem->>'make' as make, elem->>'model' as model, COUNT(DISTINCT cp.id) as parts,
        COUNT(DISTINCT CASE WHEN cp."itemSpecifics" IS NOT NULL AND jsonb_typeof(cp."itemSpecifics") = 'object' AND cp."itemSpecifics"::text != '{}' THEN cp.id END) as enriched
      FROM "CanonicalPart" cp
      JOIN "SellerOffer" so ON cp.id = so."canonicalPartId"
      JOIN "Seller" s ON so."sellerId" = s.id
      CROSS JOIN LATERAL jsonb_array_elements(cp.compatibility) elem
      WHERE so.status = 'ACTIVE' AND s."onboardingStatus" = 'ACTIVE' AND so.price > 0
        AND cp.compatibility IS NOT NULL AND jsonb_typeof(cp.compatibility) = 'array'
        AND elem->>'make' IN ('Toyota', 'BMW', 'Dodge')
      GROUP BY elem->>'make', elem->>'model'
      ORDER BY parts DESC
      LIMIT 15
    `);
    console.log('\nVehicle breakdown (target vehicles: Toyota/BMW/Dodge):');
    for (const row of v.rows) {
      const vPct = row.parts > 0 ? ((row.enriched / row.parts) * 100).toFixed(0) : 0;
      console.log(`  ${row.make} ${row.model}: ${row.enriched}/${row.parts} enriched (${vPct}%)`);
    }
    await pool2.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
