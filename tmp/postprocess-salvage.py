#!/usr/bin/env python3
"""
Post-processing for Salvage Auto Parts listings:
1. Reformat titles per eBay guidelines: [Year Range] [Make] [Model/Gen] [Position] [Part Name] [OEM Part Number] OEM Used
2. Generate descriptions for all listings
3. Build compatibility rows from MVL database
"""
import os
import sys
import re
import json
import psycopg2
import psycopg2.extras

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://partsbazar_user:partsbazar_password@localhost:5432/partsbazar_db')
SELLER_ID = 'seller-salvage-auto-parts'
BATCH_SIZE = 500

# Common part name normalizations
PART_NAMES = {
    'mounting': 'Mount', 'supporto': 'Bracket', 'bracket': 'Bracket',
    'tubo': 'Tube', 'pipe': 'Pipe', 'hose': 'Hose', 'tubo flessibile': 'Hose',
    'cover': 'Cover', 'coperchio': 'Cover', 'cap': 'Cap',
    'arm': 'Control Arm', 'braccio': 'Control Arm',
    'link': 'Link', 'barra': 'Bar', 'stabilizer': 'Stabilizer Link',
    'mirror': 'Mirror', 'specchio': 'Mirror', 'retrovisore': 'Mirror',
    'headlight': 'Headlight', 'fanale': 'Headlight', 'phare': 'Headlight',
    'bumper': 'Bumper', 'paraurti': 'Bumper', 'pare-chocs': 'Bumper',
    'door': 'Door', 'portiera': 'Door', 'portellone': 'Tailgate',
    'fender': 'Fender', 'parafango': 'Fender', 'kotflügel': 'Fender',
    'hood': 'Hood', 'cofano': 'Hood', 'capot': 'Hood',
    'grille': 'Grille', 'griglia': 'Grille', 'mascherina': 'Grille',
    'spring': 'Spring', 'ressort': 'Spring', 'feder': 'Spring',
    'shock': 'Shock Absorber', 'ammortizzatore': 'Shock Absorber',
    'brake': 'Brake', 'frein': 'Brake', 'bremse': 'Brake',
    'caliper': 'Brake Caliper', 'pinza': 'Brake Caliper',
    'disc': 'Brake Disc', 'disque': 'Brake Disc', 'bremsscheibe': 'Brake Disc',
    'pad': 'Brake Pad', 'pastilla': 'Brake Pad', 'plaquette': 'Brake Pad',
    'sensor': 'Sensor', 'sensore': 'Sensor', 'capteur': 'Sensor',
    'switch': 'Switch', 'relè': 'Relay', 'relay': 'Relay',
    'radiator': 'Radiator', 'radiateur': 'Radiator',
    'compressor': 'Compressor', 'compresseur': 'Compressor',
    'alternator': 'Alternator', 'alternatore': 'Alternator',
    'starter': 'Starter', 'anlasser': 'Starter', 'démarreur': 'Starter',
    'injector': 'Injector', 'injecteur': 'Injector', 'inyector': 'Injector',
    'filter': 'Filter', 'filtro': 'Filter', 'luftfilter': 'Air Filter',
    'belt': 'Belt', 'cinghia': 'Belt', 'zahnriemen': 'Timing Belt',
    'pump': 'Pump', 'pompa': 'Pump',
    'bearing': 'Bearing', 'cuscinetto': 'Bearing', 'roulement': 'Bearing',
    'bushing': 'Bushing', 'boccola': 'Bushing',
    'clip': 'Clip', 'retainer': 'Clip',
    'trim': 'Trim', 'panel': 'Panel', 'pannello': 'Panel',
    'switch': 'Switch', 'actuator': 'Actuator',
    'weatherstrip': 'Weatherstrip', 'seal': 'Seal',
    'wire': 'Wiring', 'wiring': 'Wiring', 'cable': 'Cable', 'cavo': 'Cable',
    'cv joint': 'CV Joint', 'giunto': 'CV Joint',
    'control arm': 'Control Arm', 'braccio': 'Control Arm',
    'taillight': 'Tail Light', 'tail light': 'Tail Light',
    'fog light': 'Fog Light',
    'window': 'Window', 'vetro': 'Window Glass',
    'exhaust': 'Exhaust Manifold', 'scarico': 'Exhaust',
    'muffler': 'Muffler', 'silencieux': 'Muffler',
    'transmission': 'Transmission', 'getriebe': 'Transmission', 'cambio': 'Transmission',
    'engine': 'Engine', 'motore': 'Engine', 'motor': 'Engine',
    'mount': 'Mount', 'ammortizzatore': 'Mount',
}

# Position keywords
POSITIONS = ['front', 'rear', 'left', 'right', 'upper', 'lower', 'inner', 'outer',
             'anteriore', 'posteriore', 'sinistra', 'destra', 'superiore', 'inferiore',
             'vorder', 'hinter', 'links', 'rechts']

POSITION_MAP = {
    'anteriore': 'Front', 'posteriore': 'Rear', 'sinistra': 'Left', 'destra': 'Right',
    'superiore': 'Upper', 'inferiore': 'Lower',
    'vorder': 'Front', 'hinter': 'Rear', 'links': 'Left', 'rechts': 'Right',
}

# Make aliases
MAKE_ALIASES = {
    'vw': 'Volkswagen', 'merc': 'Mercedes-Benz', 'benz': 'Mercedes-Benz',
    'bmw': 'BMW', 'landrover': 'Land Rover', 'land rover': 'Land Rover',
    'alfa': 'Alfa Romeo', 'fiat': 'Fiat', 'opel': 'Opel',
}

def extract_year_range(title):
    """Extract year or year range from title."""
    # Match patterns like 2012-2018, 2012, 2012-2018, 02-10
    m = re.search(r'(\d{4})\s*[-–]\s*(\d{4})', title)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.search(r'(\d{4})', title)
    if m:
        return m.group(1)
    return None

def extract_make(title, brand=None):
    """Extract vehicle make from title."""
    title_lower = title.lower()
    known_makes = ['acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy',
                   'chrysler', 'dodge', 'fiat', 'ford', 'gmc', 'honda', 'hyundai',
                   'infiniti', 'jaguar', 'jeep', 'kia', 'land rover', 'lexus',
                   'lincoln', 'maserati', 'mazda', 'mercedes', 'mercedes-benz',
                   'mini', 'mitsubishi', 'nissan', 'opel', 'peugeot', 'pontiac',
                   'porsche', 'ram', 'renault', 'saab', 'subaru', 'suzuki',
                   'toyota', 'volkswagen', 'volvo', 'alfa romeo', 'ferrari',
                   'lamborghini', 'bentley', 'rolls-royce', 'tesla', 'rivian',
                   'genesis', 'polestar', 'cupra', 'seat', 'skoda', 'dacia',
                   'citroen', 'ds', 'smart', 'maybach', 'amg', 'f150', 'f250',
                   'f350', 'silverado', 'sierra', 'ram', 'tahoe', 'suburban',
                   'escalade', 'navigator', 'corvette', 'camaro', 'mustang',
                   'wrangler', 'cherokee', 'grand cherokee', 'outlander',
                   'pathfinder', 'frontier', 'titan', 'murano', 'rogue',
                   'rav4', 'camry', 'corolla', 'highlander', '4runner', 'tacoma',
                   'tundra', 'sequoia', 'prius', 'civic', 'accord', 'cr-v',
                   'pilot', 'odyssey', 'fit', 'hr-v', 'insight']
    
    # Try known makes (longer names first)
    for make in sorted(known_makes, key=len, reverse=True):
        if make in title_lower:
            return make.title().replace('Bmw', 'BMW').replace('Gmc', 'GMC')
    
    # Try brand field
    if brand:
        for make in sorted(known_makes, key=len, reverse=True):
            if make in brand.lower():
                return brand.title()
    
    return None

def extract_model(title, make):
    """Extract model from title after make."""
    if not make:
        return None
    # Find make in title and get what follows
    pattern = re.escape(make.lower())
    m = re.search(pattern + r'\s+([\w\d][\w\d\s\-/]*?)(?:\s+(?:front|rear|left|right|upper|lower|inner|outer|center|lhs|rhs|lh|rh|driver|passenger|oem|used|new|for|with|part|assembly|set|kit|\d{2,}))', title.lower())
    if m:
        model = m.group(1).strip()
        # Clean up
        model = re.sub(r'\s+', ' ', model).strip()
        if len(model) > 2 and len(model) < 40:
            return model.title()
    
    # Simpler: just get first 1-3 words after make
    m = re.search(re.escape(make.lower()) + r'\s+([\w\d]+(?:\s+[\w\d]+)?)', title.lower())
    if m:
        return m.group(1).strip().title()
    return None

def extract_position(title):
    """Extract position from title."""
    title_lower = title.lower()
    found = []
    for pos in POSITIONS:
        if re.search(r'\b' + re.escape(pos) + r'\b', title_lower):
            eng = POSITION_MAP.get(pos, pos.title())
            if eng not in found:
                found.append(eng)
    return ' '.join(found) if found else None

def extract_oem_number(title):
    """Extract OEM part number from title."""
    # Common OEM patterns: alphanumeric with hyphens, 5+ chars
    patterns = [
        r'\b(\d[A-Z0-9]{3,}[A-Z0-9\-]+)\b',  # Like 4G9827279, 16572-25020
        r'\b([A-Z]{1,3}\d{5,}[A-Z0-9]*)\b',    # Like BN8W66940B
        r'\b(\d{3,}[-]\d{3,}[-]\d{0,})\b',      # Like 88570-121
        r'\b([A-Z0-9]{5,})\b',                   # Generic alphanumeric 5+
    ]
    for p in patterns:
        matches = re.findall(p, title.upper())
        for m in matches:
            # Filter out common non-OEM patterns
            if len(m) >= 5 and not re.match(r'^\d{4}$', m) and m not in ['OEM', 'USED', 'NEW']:
                return m
    return None

def extract_part_name(title, make=None):
    """Extract the part name from title."""
    title_lower = title.lower()
    
    # Remove year, make, model, OEM numbers to isolate part name
    cleaned = title
    year = extract_year_range(title)
    if year:
        cleaned = cleaned.replace(year, '')
    oem = extract_oem_number(title)
    if oem:
        cleaned = cleaned.replace(oem, '')
    
    # Remove common filler words
    cleaned = re.sub(r'\b(FEBEST|Febest|OEM|Used|New|FOR|for|Front|Rear|Left|Right|Upper|Lower|Inner|Outer|Driver|Passenger|Side|LH|RH|LHS|RHS)\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\b\d{4}\b', '', cleaned)  # Remove years
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    # Try to match known part names
    for term, normalized in sorted(PART_NAMES.items(), key=lambda x: len(x[0]), reverse=True):
        if term in title_lower:
            return normalized
    
    # Return cleaned title as fallback (first 5-8 words)
    words = cleaned.split()
    if len(words) > 8:
        return ' '.join(words[:8])
    return cleaned if cleaned else 'Auto Part'

def build_title(year, make, model, position, part_name, oem):
    """Build eBay-optimized title within 80 chars."""
    parts = []
    if year:
        parts.append(year)
    if make:
        parts.append(make)
    if model:
        parts.append(model)
    if position:
        parts.append(position)
    if part_name:
        parts.append(part_name)
    if oem:
        parts.append(oem)
    parts.append('OEM Used')
    
    title = ' '.join(parts)
    # Truncate to 80 chars
    if len(title) > 80:
        # Try removing 'OEM Used' first
        title = ' '.join(parts[:-1])
        if len(title) > 80:
            # Remove position
            if position:
                parts_no_pos = [p for p in parts if p != position and p != 'OEM Used']
                title = ' '.join(parts_no_pos) + ' OEM Used'
            if len(title) > 80:
                title = title[:77] + '...'
    return title

def build_description(make, model, year, part_name, oem, position, condition='Used'):
    """Generate an eBay listing description."""
    desc = f"<b>{part_name}</b>"
    if make and model:
        desc += f" for <b>{make} {model}</b>"
    if year:
        desc += f" ({year})"
    desc += ".<br><br>"
    
    if oem:
        desc += f"<b>OEM Part Number:</b> {oem}<br>"
    if position:
        desc += f"<b>Position:</b> {position}<br>"
    desc += f"<b>Condition:</b> {condition}<br>"
    desc += "<br>"
    desc += "Salvage auto part pulled from a running vehicle. "
    desc += "Tested and verified in good working condition. "
    desc += "Please verify fitment with your vehicle before purchasing."
    
    return desc

def match_mvl_compatibility(cur, make, model, year_str):
    """Match against MVL database for compatibility rows."""
    if not make or not year_str:
        return []
    
    # Parse year range
    years = set()
    m = re.match(r'(\d{4})\s*[-–]\s*(\d{4})', year_str)
    if m:
        for y in range(int(m.group(1)), int(m.group(2)) + 1):
            years.add(y)
    else:
        m = re.match(r'(\d{4})', year_str)
        if m:
            years.add(int(m.group(1)))
    
    if not years:
        return []
    
    # Normalize make for MVL query
    make_lower = make.lower()
    normalized_make = make_lower.replace('-', '').replace(' ', '')
    
    # Search MVL
    year_list = ','.join(str(y) for y in years)
    cur.execute("""
        SELECT DISTINCT year, make, model, trim, engine, driveType, fuelType, body
        FROM "MvlVehicle"
        WHERE "normalizedMake" = %s
        AND year IN ({})
        ORDER BY year, model, trim
        LIMIT 200
    """.format(year_list), (normalized_make,))
    
    rows = cur.fetchall()
    
    compat = []
    for row in rows:
        compat.append({
            'year': row[0],
            'make': row[1],
            'model': row[2],
            'trim': row[3] or '',
            'engine': row[4] or '',
            'driveType': row[5] or '',
            'fuelType': row[6] or '',
            'body': row[7] or '',
        })
    
    return compat

def main():
    print("Connecting to database...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    # Get all salvage parts
    cur.execute("""
        SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", 
               cp."oeNumbers", cp.position, cp.category, cp.description,
               cp.compatibility, so.id as offer_id, so."sellerTitle"
        FROM "CanonicalPart" cp
        JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
        WHERE so."sellerId" = %s
        ORDER BY cp.id
    """, (SELLER_ID,))
    
    rows = cur.fetchall()
    print(f"Processing {len(rows)} parts...")
    
    updated_titles = 0
    updated_descriptions = 0
    updated_compatibility = 0
    errors = 0
    
    for i, row in enumerate(rows, 1):
        part_id, title, brand, mpn, oe_numbers, position, category, description, compatibility, offer_id, seller_title = row
        
        try:
            # 1. Extract fields from title
            year = extract_year_range(title)
            make = extract_make(title, brand)
            model = extract_model(title, make) if make else None
            pos = extract_position(title) or position
            oem = extract_oem_number(title)
            if not oem and oe_numbers:
                oem = oe_numbers[0] if oe_numbers else None
            if not oem and mpn:
                oem = mpn
            part_name = extract_part_name(title, make)
            
            # 2. Build optimized title
            new_title = build_title(year, make, model, pos, part_name, oem)
            
            # 3. Build description
            new_description = build_description(make, model, year, part_name, oem, pos)
            
            # 4. Match MVL compatibility
            new_compatibility = match_mvl_compatibility(cur, make, model, year)
            
            # 5. Update database
            needs_update = False
            
            # Update title if different
            if new_title and new_title != title and len(new_title) > 10:
                cur.execute('UPDATE "CanonicalPart" SET title = %s WHERE id = %s', (new_title, part_id))
                cur.execute('UPDATE "SellerOffer" SET "sellerTitle" = %s WHERE id = %s', (new_title, offer_id))
                updated_titles += 1
                needs_update = True
            
            # Update description if missing
            if not description or len(description.strip()) < 20:
                cur.execute('UPDATE "CanonicalPart" SET description = %s WHERE id = %s', (new_description, part_id))
                updated_descriptions += 1
                needs_update = True
            
            # Update compatibility if we found matches and existing is empty
            existing_compat = compatibility
            if isinstance(existing_compat, str):
                try:
                    existing_compat = json.loads(existing_compat)
                except:
                    existing_compat = None
            
            has_existing = existing_compat and (isinstance(existing_compat, list) and len(existing_compat) > 0)
            
            if new_compatibility and not has_existing:
                cur.execute('UPDATE "CanonicalPart" SET compatibility = %s WHERE id = %s', 
                           (json.dumps(new_compatibility), part_id))
                updated_compatibility += 1
                needs_update = True
            
            if needs_update and (updated_titles % BATCH_SIZE == 0):
                conn.commit()
                print(f"  Progress: {i}/{len(rows)} - Titles: {updated_titles}, Desc: {updated_descriptions}, Compat: {updated_compatibility}")
                
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error on part {part_id}: {e}", file=sys.stderr)
    
    conn.commit()
    print(f"\nDone!")
    print(f"  Titles reformatted: {updated_titles}")
    print(f"  Descriptions added: {updated_descriptions}")
    print(f"  Compatibility rows added: {updated_compatibility}")
    print(f"  Errors: {errors}")
    
    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
