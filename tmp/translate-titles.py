#!/usr/bin/env python3
"""
Translate non-English part titles in the database to English.
Uses deep-translator (Google Translate free API).
"""
import os
import sys
import time
import psycopg2
from deep_translator import GoogleTranslator

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://partsbazar_user:partsbazar_password@localhost:5432/partsbazar_db')
SELLER_ID = 'seller-salvage-auto-parts'
BATCH_SIZE = 50

# Common automotive term translations for speed/accuracy
AUTO_TERMS = {
    # Italian
    'albero': 'shaft', 'coperchio': 'cover', 'pompa': 'pump', 'altoparlante': 'speaker',
    'sterzo': 'steering', 'cinghia': 'belt', 'motore': 'engine', 'anteriore': 'front',
    'posteriore': 'rear', 'destra': 'right', 'sinistra': 'left', 'pannello': 'panel',
    'parafango': 'fender', 'fanale': 'headlight', 'specchio': 'mirror', 'maniglia': 'handle',
    'tubo': 'tube', 'olio': 'oil', 'ammortizzatore': 'shock absorber', 'barra': 'bar',
    'ponte': 'bridge', 'differenziale': 'differential', 'giunto': 'joint',
    'cambio': 'gearbox', 'scatola': 'box', 'portiera': 'door', 'cofano': 'hood',
    'cruscotto': 'dashboard', 'compressore': 'compressor', 'alternatore': 'alternator',
    'sensore': 'sensor', 'bobina': 'coil', 'cavo': 'cable', 'fusibile': 'fuse',
    'scarico': 'exhaust', 'parabrezza': 'windshield', 'lunotto': 'rear window',
    'finestrino': 'window', 'retrovisore': 'mirror', 'griglia': 'grille',
    'portellone': 'tailgate', 'radiatore': 'radiator', 'termostato': 'thermostat',
    'cuscino': 'cushion', 'paraurti': 'bumper', 'asse': 'axle', 'cuscinetto': 'bearing',
    'tirante': 'tie rod', 'biella': 'connecting rod', 'boccola': 'bushing',
    'rinforzo': 'reinforcement', 'comando': 'control', 'braccio': 'arm',
    'inferiore': 'lower', 'superiore': 'upper', 'iniezione': 'injection',
    'trasmissione': 'transmission', 'accessori': 'accessories', 'centralina': 'ecu',
    'candeletta': 'glow plug', 'relè': 'relay', 'collettore': 'collector',
    'aspirazione': 'intake', 'marmitta': 'muffler', 'silenzioso': 'silencer',
    'longherone': 'frame rail', 'traversa': 'crossmember', 'vetro': 'glass',
    'condotto': 'duct', 'miscela': 'mixture', 'soffietto': 'bellows',
    'copertura': 'cover', 'guscio': 'shell', 'mascherina': 'grille',
    'calandra': 'grille', 'cornice': 'frame', 'vano': 'compartment',
    # French
    'roue': 'wheel', 'pneu': 'tire', 'capot': 'hood', 'phares': 'headlights',
    'pare-brise': 'windshield', 'hayon': 'tailgate', 'aile': 'fender',
    'rotule': 'ball joint', 'roulement': 'bearing', 'bague': 'ring',
    'frein': 'brake', 'amort': 'shock', 'ressort': 'spring',
    'biellette': 'link', 'essieu': 'axle', 'triangle': 'control arm',
    'cardan': 'cv joint', 'embrayage': 'clutch', 'vilebrequin': 'crankshaft',
    'soupape': 'valve', 'injecteur': 'injector', 'carburant': 'fuel',
    'échappement': 'exhaust', 'silencieux': 'muffler', 'catalyseur': 'catalytic converter',
    'disque': 'disc', 'plaquette': 'pad', 'tambour': 'drum',
    'amortisseur': 'shock absorber', 'crémaillère': 'rack', 'pare-chocs': 'bumper',
    'portière': 'door', 'coffre': 'trunk', 'siège': 'seat', 'levier': 'lever',
    'bougie': 'spark plug', 'radiateur': 'radiator', 'compresseur': 'compressor',
    # German
    'getriebe': 'transmission', 'lenk': 'steering', 'brems': 'brake',
    'feder': 'spring', 'dämpf': 'damper', 'stoß': 'impact', 'abgas': 'exhaust',
    'auspuff': 'exhaust', 'kotfl': 'fender', 'tür': 'door', 'haube': 'hood',
    'scheibe': 'window', 'scheinwerfer': 'headlight', 'spiegel': 'mirror',
    'halter': 'bracket', 'lager': 'bearing', 'buchse': 'bushing', 'nabe': 'hub',
    'achse': 'axle', 'stabil': 'stabilizer', 'quer': 'cross',
    'zahnriemen': 'timing belt', 'keilriemen': 'v-belt', 'kurbel': 'crank',
    'nocken': 'cam', 'zylinder': 'cylinder', 'kolben': 'piston', 'pleuel': 'rod',
    'ventil': 'valve', 'zünd': 'ignition', 'einspritz': 'injection',
    'kraftstoff': 'fuel', 'luftfilter': 'air filter', 'ölkühler': 'oil cooler',
    'bremsscheibe': 'brake disc', 'bremse': 'brake', 'kupplung': 'clutch',
    'differenzial': 'differential', 'motorhaube': 'hood', 'kotflügel': 'fender',
    'stoßstange': 'bumper', 'anlasser': 'starter', 'lichtmaschine': 'alternator',
    'zündkerze': 'spark plug', 'katalysator': 'catalytic converter',
    'querlenker': 'control arm', 'stoßdämpfer': 'shock absorber',
    'radlager': 'wheel bearing', 'radnabe': 'wheel hub',
    # Spanish
    'rueda': 'wheel', 'neumático': 'tire', 'parachoques': 'bumper',
    'espejo': 'mirror', 'farol': 'headlight', 'guardabaro': 'fender',
    'puerta': 'door', 'maletero': 'trunk', 'volante': 'steering wheel',
    'dirección': 'steering', 'amortiguador': 'shock absorber', 'muelle': 'spring',
    'suspensión': 'suspension', 'embrague': 'clutch', 'inyector': 'injector',
    'filtro': 'filter', 'silenciador': 'muffler', 'pinza': 'caliper',
    'pastilla': 'pad',
}

def detect_non_english(title):
    """Check if title contains non-English automotive terms."""
    lower = title.lower()
    for term in AUTO_TERMS:
        if term in lower:
            return True
    return False

def translate_title(title, translator):
    """Translate title to English."""
    try:
        translated = translator.translate(title)
        return translated if translated else title
    except Exception as e:
        print(f"  Translation error: {e}", file=sys.stderr)
        return title

def main():
    print("Connecting to database...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    # Find non-English titles
    cur.execute("""
        SELECT cp.id, cp.title 
        FROM "CanonicalPart" cp
        JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
        WHERE so."sellerId" = %s
        AND cp.title IS NOT NULL
        AND cp.title != ''
        ORDER BY cp.id
    """, (SELLER_ID,))
    
    rows = cur.fetchall()
    print(f"Found {len(rows)} parts to check")
    
    translator = GoogleTranslator(source='auto', target='en')
    translated_count = 0
    skipped_count = 0
    
    for i, (part_id, title) in enumerate(rows, 1):
        if not detect_non_english(title):
            skipped_count += 1
            continue
        
        # Translate
        translated = translate_title(title, translator)
        
        if translated != title:
            cur.execute("""
                UPDATE "CanonicalPart" 
                SET title = %s 
                WHERE id = %s
            """, (translated, part_id))
            translated_count += 1
            
            if translated_count % 10 == 0:
                print(f"  Translated {translated_count} titles so far...")
                conn.commit()
        
        # Rate limit to avoid hitting API limits
        if translated_count % 100 == 0 and translated_count > 0:
            time.sleep(1)
    
    conn.commit()
    print(f"\nDone! Translated {translated_count} titles, skipped {skipped_count} English titles")
    
    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
