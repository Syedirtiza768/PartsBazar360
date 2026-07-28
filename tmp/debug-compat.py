import psycopg2, re

conn = psycopg2.connect('postgresql://partsbazar_user:partsbazar_password@172.18.0.3:5432/partsbazar_db')
cur = conn.cursor()

cur.execute("""
    SELECT cp.title FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    WHERE so."sellerId" = 'seller-salvage-auto-parts'
    AND (cp.compatibility IS NULL OR cp.compatibility::text IN ('null', '[]', ''))
    LIMIT 10
""")
print("Sample titles without compatibility:")
for r in cur:
    print(f"  {r[0][:100]}")

# Check how many salvage parts total have compatibility already
cur.execute("""
    SELECT COUNT(*) FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    WHERE so."sellerId" = 'seller-salvage-auto-parts'
    AND cp.compatibility IS NOT NULL AND cp.compatibility::text NOT IN ('null', '[]', '')
""")
print(f"\nSalvage parts WITH compatibility: {cur.fetchone()[0]}")

cur.execute("""
    SELECT COUNT(*) FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    WHERE so."sellerId" = 'seller-salvage-auto-parts'
""")
print(f"Total salvage parts: {cur.fetchone()[0]}")

conn.close()
