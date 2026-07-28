#!/usr/bin/env python3
"""
Build compatibility rows from MVL for salvage parts without them.
Handles: (1) year+make, (2) make+model when year is missing.
"""
import os, sys, re, json, psycopg2

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://partsbazar_user:partsbazar_password@172.18.0.3:5432/partsbazar_db')
SELLER_ID = 'seller-salvage-auto-parts'
BATCH = 500

MAKES = {
    'audi': 'AUDI', 'bmw': 'BMW', 'jaguar': 'JAGUAR', 'lexus': 'LEXUS',
    'mercedes-benz': 'MERCEDESBENZ', 'mercedes': 'MERCEDESBENZ',
    'ford': 'FORD', 'chevrolet': 'CHEVROLET', 'chevy': 'CHEVROLET',
    'toyota': 'TOYOTA', 'nissan': 'NISSAN', 'honda': 'HONDA', 'dodge': 'DODGE',
    'volkswagen': 'VOLKSWAGEN', 'vw': 'VOLKSWAGEN', 'mazda': 'MAZDA', 'cadillac': 'CADILLAC',
    'porsche': 'PORSCHE', 'gmc': 'GMC', 'buick': 'BUICK', 'chrysler': 'CHRYSLER',
    'jeep': 'JEEP', 'kia': 'KIA', 'hyundai': 'HYUNDAI', 'infiniti': 'INFINITI',
    'acura': 'ACURA', 'subaru': 'SUBARU', 'mitsubishi': 'MITSUBISHI', 'volvo': 'VOLVO',
    'land rover': 'LANDROVER', 'range rover': 'RANGEROVER', 'mini': 'MINI',
    'maserati': 'MASERATI', 'bentley': 'BENTLEY', 'rolls royce': 'ROLLSROYCE',
    'ram': 'RAM', 'fiat': 'FIAT', 'saab': 'SAAB', 'pontiac': 'PONTIAC',
    'scion': 'SCION', 'suzuki': 'SUZUKI', 'tesla': 'TESLA', 'genesis': 'GENESIS',
    'isuzu': 'ISUZU', 'lincoln': 'LINCOLN', 'peugeot': 'PEUGEOT', 'renault': 'RENAULT',
    'citroen': 'CITROEN', 'alfa romeo': 'ALFAROMEO', 'ferrari': 'FERRARI',
    'lamborghini': 'LAMBORGHINI', 'aston martin': 'ASTONMARTIN',
    'freightliner': 'FREIGHTLINER', 'peterbilt': 'PETERBILT', 'kenworth': 'KENWORTH',
}

def parse_title(title):
    """Extract year(s), normalized make, and model hint from title."""
    tl = title.lower()

    # Year
    m = re.search(r'(\d{4})\s*[-–]\s*(\d{4})', tl)
    if m:
        yr1, yr2 = int(m.group(1)), int(m.group(2))
    else:
        m = re.search(r'(\d{4})', tl)
        if m:
            yr1 = yr2 = int(m.group(1))
        else:
            yr1 = yr2 = None

    # Make - try longest matches first
    norm_make = None
    for make_str in sorted(MAKES.keys(), key=len, reverse=True):
        if re.search(r'\b' + re.escape(make_str) + r'\b', tl):
            norm_make = MAKES[make_str]
            break

    return yr1, yr2, norm_make

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Pre-load MVL into memory by (make, year) for fast lookup
    print("Loading MVL database...", flush=True)
    cur.execute("""
        SELECT "normalizedMake", year, make, model, COALESCE(trim,''), COALESCE(engine,'')
        FROM "MvlVehicle" WHERE market = 'US'
    """)
    mvl_by_make_year = {}
    mvl_by_make = {}  # fallback: all years for a make
    for row in cur:
        key_my = (row[0], row[1])
        if key_my not in mvl_by_make_year:
            mvl_by_make_year[key_my] = []
        mvl_by_make_year[key_my].append({
            'year': row[1], 'make': row[2], 'model': row[3],
            'trim': row[4], 'engine': row[5]
        })
        if row[0] not in mvl_by_make:
            mvl_by_make[row[0]] = []
        mvl_by_make[row[0]].append({
            'year': row[1], 'make': row[2], 'model': row[3],
            'trim': row[4], 'engine': row[5]
        })
    print(f"Loaded {len(mvl_by_make_year)} make+year combos, {len(mvl_by_make)} makes", flush=True)

    # Get salvage parts without compatibility
    cur.execute("""
        SELECT cp.id, cp.title
        FROM "CanonicalPart" cp
        JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
        WHERE so."sellerId" = %s
        AND (cp.compatibility IS NULL OR cp.compatibility::text IN ('null', '[]', ''))
        ORDER BY cp.id
    """, (SELLER_ID,))
    parts = cur.fetchall()
    print(f"Found {len(parts)} salvage parts without compatibility", flush=True)

    updated = 0
    skipped = 0
    no_year_count = 0

    for i, (part_id, title) in enumerate(parts, 1):
        yr1, yr2, norm_make = parse_title(title)

        if not norm_make:
            skipped += 1
            continue

        compat = []
        if yr1:
            # Match by make + year range
            for yr in range(yr1, yr2 + 1):
                key = (norm_make, yr)
                if key in mvl_by_make_year:
                    compat.extend(mvl_by_make_year[key])
        else:
            # No year in title — use all years for this make (limited)
            no_year_count += 1
            if norm_make in mvl_by_make:
                # Take a sample across years (first 50 to avoid huge lists)
                compat = mvl_by_make[norm_make][:50]

        if not compat:
            skipped += 1
            continue

        # Deduplicate and limit
        seen = set()
        unique_compat = []
        for row in compat:
            k = (row['year'], row['make'], row['model'], row['trim'], row['engine'])
            if k not in seen and len(unique_compat) < 200:
                seen.add(k)
                unique_compat.append(row)

        if unique_compat:
            cur.execute('UPDATE "CanonicalPart" SET compatibility = %s WHERE id = %s',
                       (json.dumps(unique_compat), part_id))
            updated += 1

        if updated % BATCH == 0 and updated > 0:
            conn.commit()
            print(f"Progress: {i}/{len(parts)} - Updated: {updated}, Skipped: {skipped}, No-year: {no_year_count}", flush=True)

    conn.commit()
    print(f"\nDone! Updated: {updated}, Skipped: {skipped}, No-year parts: {no_year_count}", flush=True)

    # Final count
    cur.execute("""
        SELECT COUNT(*) FROM "CanonicalPart" cp
        JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
        WHERE so."sellerId" = %s
        AND cp.compatibility IS NOT NULL AND cp.compatibility::text NOT IN ('null', '[]', '')
    """, (SELLER_ID,))
    print(f"Total salvage parts with compatibility now: {cur.fetchone()[0]}", flush=True)

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
