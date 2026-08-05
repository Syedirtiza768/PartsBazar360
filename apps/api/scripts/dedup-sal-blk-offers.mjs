#!/usr/bin/env node
/**
 * Deduplicate Salvage (SAL) and Blackline (BLK) SellerOffers.
 *
 * Rules:
 *   1. Within each sourceTag (SAL/BLK), for each canonicalPartId, keep ONLY
 *      the lowest-price ACTIVE offer — deactivate all others.
 *   2. When a canonicalPartId has active offers from BOTH SAL and BLK after
 *      step 1, keep only the single cheapest and deactivate the other source.
 *   3. Re-apply English-only gate (looksLikeEnglishTitle) and eBay Mag gate
 *      (storage.ebaymag.com in imageUrls) on ALL remaining active SAL/BLK
 *      offers — deactivate any that fail.
 *   4. Reindex every affected canonical part in OpenSearch.
 *
 * Usage (inside API container):
 *   node scripts/dedup-sal-blk-offers.mjs              # DRY RUN
 *   CONFIRM=1 node scripts/dedup-sal-blk-offers.mjs    # apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CONFIRM = process.env.CONFIRM === '1';
const OS = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const INDEX = process.env.INDEX || 'canonical_parts';
const BATCH = 200;
const SCOPE = ['SAL', 'BLK'];

// ── English gate (mirrors listing-title.util.ts) ──

const GERMAN_SUBSTRING_TERMS = [
  'aschenbecher','bremsleitung','einstiegsleiste','kabelbinder','dichtband',
  'schutzring','kugellager','halteklemme','kantenschutz','sitzkissenbezug',
  'sitzpolster','armlehnenbezug','popniete','klemmplatte','radhaus',
  'innenspiegel','federbein','halterung','armaturenbrett','seitenscheibe',
  'spannfeder','riegel','seitenschweller','heckspoiler','seitenmarkierung',
  'seitenmarkierungsleuchte','kennzeichen','kennzeichenbeleuchtung',
  'innenraum','innenverkleidung','klimaanlage','klimakompressor',
  'kuehlergrill','kuehlmittel','kuehlmittelschlauch','kuehler','luefter',
  'luefterrad','waermetauscher','ventildeckel','zahnriemen','keilriemen',
  'schaltknauf','handschuhfach','mittelkonsole','instrumententafel',
  'sicherheitsgurt','gurtstraffer','fensterheber','dachhimmel','schiebedach',
  'verkleidung','abdeckung','dichtung','lueftung','blende','leiste',
  'halteclip','befestigungsclip','klammer','distanzstueck',
  'fuehrungsschiene','fuehrungs','leitung','kabel','stecker','steckverbinder',
  'rohr','schlauch','luftschlauch','wasserschlauch','tuergriff','kofferraum',
  'tuerschloss','tuerverkleidung','manschette','faltenbalg','wellrohr',
  'gleitlager','lagerbock','achslenker','achszapfen','stuetzlager',
  'stuetz','gleitfuehrung','stellhebel','stellglied','heckklappe',
  'abschlepp','radhausverkleidung','radlauf','radlaufverkleidung',
  'unterbodenschutz','thermostatgehaeuse','oeldruckanzeige',
  'oelkuehlgehaeuse','zuendschloss','zuendkappe','kraftstofftank',
  'kraftstofffilter','kraftstoffdruck','sicherungskasten','anlasserkurbel',
  'anlasserrelais','drosselklappe','drosselklappengehaeuse','ansaugkruemmer',
  'ansaugrohr','ansaugstutzen','ladeluftkuehler','ladeluftrohr',
  'ladeluftschlauch','ladedruck','abgaskruemmer','abgasrohr','abgasanlage',
  'endschalldaempfer','vorschalldaempfer','partikelfilter',
  'dieselpartikelfilter','getriebe','schaltung','schaltgetriebe',
  'automatikgetriebe','kupplung','differenzial','antriebswelle',
  'gelenkwelle','kardanwelle','kurbelwelle','nockenwelle','pleuelstange',
  'pleuel','zylinder','zylinderkopf','kolben','nocken','kurbel',
  'einspritz','einspritzpumpe','einspritzduese','einspritzventil',
  'kraftstoff','kraftstoffpumpe','kraftstoffschlauch','luftfilter',
  'luftfiltergehaeuse','oelkuehler','oelfilter','oelpumpe','oeldruck',
  'oelschlauch','bremsscheibe','bremse','bremssattel','bremsbelag',
  'bremsschlauch','bremstrommel','bremszylinder','handbremse',
  'feststellbremse','bremslicht','lenkrad','lenksaeule','lenkgetriebe',
  'lenkstockhebel','lenker','schaltgestaenge','kupplungsnehmer',
  'kupplungsgeber','anlasser','lichtmaschine','zuendkerze','zuendspule',
  'zuendkabel','zuendverteiler','zuend','auspuff','auspuffkruemmer',
  'endtopf','katalysator','abgas','kruemmer','stossstange','stossdaempfer',
  'stossfaenger','schraubenfeder','daempfer','schallabsorber','motorhaube',
  'kotfluegel','kotfl','seitenspiegel','rueckspiegel','aussenspiegel',
  'ruecklicht','rueckleuchte','scheinwerfer','nebellampe','nebelleuchte',
  'scheinwerferreinigung','wasserpumpe','wasserpumpenrad','tuer','schenkel',
  'buchse','huelse','nabe','achse','schiene','stoss','schweller',
  'unterboden','sicherung','relais','schalter','schloss','innen','spange',
  'klemme','schelle','riemen','gurt','schnalle','oese','knopf','hebel',
  'schwungrad','drehzahlmesser','drehzahl','drossel','ladeluft',
  'lambdasonde','sonde','harnstoff','adblue','gehaeuse','deckel','kappe',
  'sockel','stuetze','traeger','aufnahme','fuehrung','stellschraube',
  'radnabe','radlager','radlauf','radkappe','radbolzen','radlenker',
  'radfeder','radhausverkleidung','radabweiser','radbremszylinder',
];

const GERMAN_WORD_TERMS = [
  'rad','feder','lager','stabil','quer','halter','hinter','vorder',
  'gebraucht',
];

const NON_ENGLISH_WORD_TERMS = [
  'albero','coperchio','pompa','altoparlante','sterzo','cinghia','motore',
  'anteriore','posteriore','destra','sinistra','volant','modanatura',
  'passaruota','pannello','bilanciere','occasion','schermo','portiera',
  'cofano','parafango','sospension','frenata','cremagliera','pignone',
  'biella','boccola','raccordo','regolazione','rinforzo','comando',
  'braccio','inferiore','superiore','raccolta','iniezione','secondaria',
  'trasmissione','accessori','termostato','cuscino','paraurti','specchio',
  'fanale','asse','cambio','scatola','tubo','olio','acqua','montante',
  'cuscinetto','ammortizzatore','tirante','barra','ponte','differenziale',
  'semiass','giunto','omocinetico','scudo','predellino','maniglia',
  'chiusura','serratura','cassetto','plancia','cruscotto','climatizzatore',
  'compressore','alternatore','motorino','centralina','sensore','sonda',
  'lambdasonda','candeletta','bobina','cavo','fusibile','rel','relais',
  'pompetta','collettore','aspirazione','scarico','marmitta','silenzioso',
  'longherone','traversa','parabrezza','lunotto','finestrino','vetrino',
  'vetro','retrovisore','retrovisori','specchietto','condotto','quadro',
  'strumenti','presa','bocchettone','bocchetta','flusso','miscela',
  'soffietto','mantice','convogliatore','deflettore','paraschizzi',
  'paraspruzzi','copertura','supporto','copripavimento','guarnizione',
  'ginocchiere','bracciolo','posacenere','copribracciolo','tappeto',
  'piastra','adattatore','distintivo','terminale','staffa','sportello',
  'pedana','portafusibile','alloggiamento','attacco','misuratore',
  'portata','tappo','sostegno','protezione','rivestimento','autoadesivo',
  'imbottitura','sedile','fascetta','stringitubo','fodera','sottoscocca',
  'pedale','freno','isolamento','acustico','bullone','svasato',
  'esagonale','ruota','telaio','schienale','guscio','carena','carenatura',
  'griglia','mascherina','calandra','fascione','listello','cornice',
  'portellone','portone','baule','vano','sfiato',
  'roue','pneu','capot','pare','choc','essu','glace','phares','hayon',
  'aile','rotule','roulement','bague','durit','refroid','clim','ventil',
  'allume','altern','batterie','frein','amort','ressort','coupelle',
  'biellette','essieu','triangul','bercage','flasque','moyeu','cardan',
  'embrayage','vilebrequin','soupape','injecteur','carburant',
  'silencieux','catalyseur','disque','plaquette','tambour','amortisseur',
  'ressorts','stabilisatrice','triangle','parechoc','caisse','indicateur',
  'changement','vitesse','automatique','manuelle','clignotant','portiere',
  'coffre','banquette','garnissage','habitacle','commodo','boitier',
  'calculateur','carburateur','allumage','culasse','demarreur','jante',
  'pneumatique','tableau','commande','cylindre','pedale','phare','feu',
  'siege','levier','capteur','bougie','cable','radiateur','refroidissement',
  'climatisation','compresseur',
  'rueda','parachoques','paragolpes','espejo','farol','guardabarro',
  'aleta','puerta','maletero','cofre','volante','amortiguador','muelle',
  'mangueta','rodamiento','embrague','ciguenal','inyector','filtro',
  'silenciador','pinza','pastilla','cubierta','manillar',
];

const WORD_BOUNDARY_RE = new RegExp(
  `(?<!\\p{L})(?:${[...GERMAN_WORD_TERMS, ...NON_ENGLISH_WORD_TERMS].join('|')})(?!\\p{L})`,
  'iu',
);

const NON_LATIN_SCRIPT_RE =
  /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3000-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;

const GERMAN_UMLAUT_RE = /[äöüß]/i;

function looksLikeEnglishTitle(title) {
  const value = String(title ?? '').trim();
  if (!value) return false;
  if (NON_LATIN_SCRIPT_RE.test(value)) return false;
  const lower = value.toLowerCase();
  if (GERMAN_UMLAUT_RE.test(lower)) return false;
  for (const term of GERMAN_SUBSTRING_TERMS) {
    if (lower.includes(term)) return false;
  }
  return !WORD_BOUNDARY_RE.test(value);
}

function isEbayMagImageUrl(url) {
  return /storage\.ebaymag\.com\//i.test(String(url || ''));
}

function hasEbayMagImages(imageUrls) {
  return Array.isArray(imageUrls) && imageUrls.some(isEbayMagImageUrl);
}

// ── OpenSearch helper ──

async function os(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${OS}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

async function reindexParts(prisma, partIds) {
  let reindexed = 0;
  let failed = 0;
  for (let i = 0; i < partIds.length; i += BATCH) {
    const slice = partIds.slice(i, i + BATCH);
    const parts = await prisma.canonicalPart.findMany({
      where: { id: { in: slice } },
      include: {
        partNumbers: true,
        fitments: {
          include: {
            vehicleConfig: {
              include: {
                generation: {
                  include: { model: { include: { make: true } } },
                },
              },
            },
          },
        },
        offers: {
          where: { status: 'ACTIVE', seller: { onboardingStatus: 'ACTIVE' } },
          include: { seller: { select: { id: true, name: true, onboardingStatus: true } } },
        },
      },
    });
    for (const part of parts) {
      try {
        const activeOffers = part.offers;
        if (activeOffers.length === 0) continue;
        const doc = toDoc(part, activeOffers);
        await os(`/${INDEX}/_doc/${doc.id}`, { method: 'PUT', body: doc });
        reindexed++;
      } catch (err) {
        failed++;
        if (failed <= 10) {
          console.warn(`  reindex failed ${part.id}: ${err.message}`);
        }
      }
    }
    console.log(`  ... reindexed ${Math.min(i + BATCH, partIds.length)}/${partIds.length} (ok=${reindexed} fail=${failed})`);
  }
  return { reindexed, failed };
}

function toDoc(part, activeOffers) {
  const partNumbers = part.partNumbers || [];
  const minPrice = activeOffers.length > 0
    ? Math.min(...activeOffers.map((o) => o.price ?? Infinity))
    : null;
  return {
    id: part.id,
    title: part.title,
    partType: part.partType || null,
    brand: part.brand,
    manufacturerPartNumber: part.manufacturerPartNumber || null,
    partNumbers,
    normalizedPartNumbers: partNumbers
      .filter((n) => n.numberType !== 'OEM_CROSS_REFERENCE')
      .map((n) => n.normalizedNumber)
      .filter(Boolean),
    category: part.category,
    makes: [...new Set([
      ...(Array.isArray(part.compatibility) ? part.compatibility.map((c) => c.make).filter(Boolean) : []),
      ...(part.fitments || [])
        .map((f) => f.vehicleConfig?.generation?.model?.make?.name)
        .filter(Boolean),
    ])],
    oeNumbers: part.oeNumbers || [],
    interchangePartNumbers: partNumbers
      .filter((n) => n.numberType === 'OEM_CROSS_REFERENCE')
      .map((n) => n.normalizedNumber)
      .filter(Boolean),
    imageUrls: part.imageUrls || [],
    listingUrl: part.listingUrl || null,
    ebayItemId: part.ebayItemId || null,
    partSource: part.partSource || null,
    qualityTier: part.qualityTier || null,
    fitmentStatus: part.fitmentStatus || null,
    fitmentConfidence: part.fitmentConfidence ?? null,
    createdAt: part.createdAt?.toISOString?.() || part.createdAt || new Date().toISOString(),
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    fitments: (part.fitments || [])
      .filter((f) => ['A', 'B'].includes(f.evidenceLevel) && Number(f.confidence) >= 0.8)
      .map((f) => f.vehicleConfigId),
    offers: activeOffers.map((o) => ({
      id: o.id,
      price: o.price,
      currency: o.currency || null,
      condition: o.condition,
      partSource: o.partSource || null,
      qualityTier: o.qualityTier || null,
      sellerId: o.sellerId,
      sellerName: o.seller?.name || null,
      sourceTag: o.sourceTag || null,
    })),
    sourceTags: [...new Set(activeOffers.map((o) => o.sourceTag).filter(Boolean))],
  };
}

// ── Main ──

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── STEP 1: Within-source dedup ──
    console.log('=== STEP 1: Within-source dedup (keep lowest price per canonicalPartId per sourceTag) ===');

    const allOffers = await prisma.sellerOffer.findMany({
      where: { status: 'ACTIVE', sourceTag: { in: SCOPE } },
      select: { id: true, canonicalPartId: true, sourceTag: true, price: true },
      orderBy: { price: 'asc' },
    });

    console.log(`Total active SAL/BLK offers: ${allOffers.length}`);

    // Group by (sourceTag, canonicalPartId) — offers already sorted by price asc
    const grouped = new Map();
    for (const o of allOffers) {
      const key = `${o.sourceTag}|${o.canonicalPartId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(o);
    }

    const withinDedupIds = [];
    for (const [, offers] of grouped) {
      if (offers.length > 1) {
        // Keep index 0 (cheapest), deactivate rest
        for (let i = 1; i < offers.length; i++) {
          withinDedupIds.push(offers[i].id);
        }
      }
    }

    console.log(`Within-source offers to deactivate: ${withinDedupIds.length}`);

    // ── STEP 2: Cross-source dedup ──
    console.log('=== STEP 2: Cross-source dedup (when both SAL & BLK exist, keep cheapest) ===');

    // After step 1, each (sourceTag, canonicalPartId) has at most 1 offer.
    // Now find canonicalPartIds that still have offers from BOTH SAL and BLK.
    const afterStep1 = await prisma.sellerOffer.findMany({
      where: {
        status: 'ACTIVE',
        sourceTag: { in: SCOPE },
        id: { notIn: withinDedupIds },
      },
      select: { id: true, canonicalPartId: true, sourceTag: true, price: true },
      orderBy: { price: 'asc' },
    });

    const byPart = new Map();
    for (const o of afterStep1) {
      if (!byPart.has(o.canonicalPartId)) byPart.set(o.canonicalPartId, []);
      byPart.get(o.canonicalPartId).push(o);
    }

    const crossDedupIds = [];
    for (const [partId, offers] of byPart) {
      const sources = new Set(offers.map((o) => o.sourceTag));
      if (sources.size > 1) {
        // Offers sorted by price asc — keep cheapest, deactivate rest
        const cheapest = offers[0];
        for (let i = 1; i < offers.length; i++) {
          crossDedupIds.push(offers[i].id);
        }
      }
    }

    console.log(`Cross-source offers to deactivate: ${crossDedupIds.length}`);

    // ── STEP 3: Gate enforcement ──
    console.log('=== STEP 3: English-only + No-eBay-Mag gate enforcement ===');

    const dedupIgnoreSet = new Set([...withinDedupIds, ...crossDedupIds]);

    const remaining = await prisma.sellerOffer.findMany({
      where: {
        status: 'ACTIVE',
        sourceTag: { in: SCOPE },
        id: { notIn: [...dedupIgnoreSet] },
      },
      include: {
        canonicalPart: { select: { id: true, title: true, imageUrls: true } },
      },
    });

    const gateDeactivateIds = [];
    let nonEnglish = 0;
    let ebayMag = 0;
    const gateSamples = [];

    for (const o of remaining) {
      const title = o.canonicalPart?.title ?? '';
      const isNonEn = !!title && !looksLikeEnglishTitle(title);
      const hasMag = hasEbayMagImages(o.canonicalPart?.imageUrls);
      if (isNonEn || hasMag) {
        gateDeactivateIds.push(o.id);
        if (isNonEn) nonEnglish++;
        if (hasMag) ebayMag++;
        if (gateSamples.length < 15) {
          gateSamples.push(
            `[${o.sourceTag}] ${title}${isNonEn ? ' NON-EN' : ''}${hasMag ? ' EBAYMAG' : ''}`,
          );
        }
      }
    }

    console.log(`Gate offers to deactivate: ${gateDeactivateIds.length} (non-English=${nonEnglish}, ebayMag=${ebayMag})`);
    if (gateSamples.length) {
      console.log('Samples:');
      for (const s of gateSamples) console.log(`  ${s}`);
    }

    // ── Summary ──
    const allDeactivateIds = [...new Set([...withinDedupIds, ...crossDedupIds, ...gateDeactivateIds])];
    const affectedPartIds = new Set();
    for (const o of [...allOffers]) {
      if (allDeactivateIds.includes(o.id)) affectedPartIds.add(o.canonicalPartId);
    }

    // Also include parts affected by gate deactivations
    for (const o of remaining) {
      if (gateDeactivateIds.includes(o.id)) affectedPartIds.add(o.canonicalPartId);
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Within-source dedup: ${withinDedupIds.length} offers`);
    console.log(`Cross-source dedup:  ${crossDedupIds.length} offers`);
    console.log(`Gate enforcement:    ${gateDeactivateIds.length} offers`);
    console.log(`TOTAL to deactivate: ${allDeactivateIds.length} offers`);
    console.log(`Affected parts:      ${affectedPartIds.size}`);

    if (!CONFIRM) {
      console.log('\nDRY RUN — set CONFIRM=1 to apply.');
      return;
    }

    if (allDeactivateIds.length === 0) {
      console.log('Nothing to deactivate.');
      return;
    }

    // ── Execute deactivations ──
    const DEACTIVATE_BATCH = 500;
    let deactivated = 0;
    for (let i = 0; i < allDeactivateIds.length; i += DEACTIVATE_BATCH) {
      const slice = allDeactivateIds.slice(i, i + DEACTIVATE_BATCH);
      const result = await prisma.sellerOffer.updateMany({
        where: { id: { in: slice } },
        data: { status: 'INACTIVE' },
      });
      deactivated += result.count;
      console.log(`  deactivated ${Math.min(i + DEACTIVATE_BATCH, allDeactivateIds.length)}/${allDeactivateIds.length}`);
    }
    console.log(`Deactivated ${deactivated} offers total.`);

    // ── Reindex ──
    console.log('\n=== REINDEXING affected parts ===');
    const partIdsArr = [...affectedPartIds];
    const { reindexed, failed } = await reindexParts(prisma, partIdsArr);
    console.log(`Reindex complete: ${reindexed} ok, ${failed} failed`);

    // ── Verify ──
    console.log('\n=== VERIFICATION ===');
    const verifyOffers = await prisma.sellerOffer.findMany({
      where: { status: 'ACTIVE', sourceTag: { in: SCOPE } },
      select: { id: true, canonicalPartId: true, sourceTag: true, price: true },
      orderBy: { price: 'asc' },
    });

    // Check within-source dupes
    const verifyGrouped = new Map();
    for (const o of verifyOffers) {
      const key = `${o.sourceTag}|${o.canonicalPartId}`;
      if (!verifyGrouped.has(key)) verifyGrouped.set(key, []);
      verifyGrouped.get(key).push(o);
    }
    let withinDupes = 0;
    for (const [, offers] of verifyGrouped) {
      if (offers.length > 1) withinDupes += offers.length - 1;
    }

    // Check cross-source dupes
    const verifyByPart = new Map();
    for (const o of verifyOffers) {
      if (!verifyByPart.has(o.canonicalPartId)) verifyByPart.set(o.canonicalPartId, []);
      verifyByPart.get(o.canonicalPartId).push(o);
    }
    let crossDupes = 0;
    for (const [, offers] of verifyByPart) {
      const sources = new Set(offers.map((o) => o.sourceTag));
      if (sources.size > 1) crossDupes += offers.length - 1;
    }

    console.log(`Active SAL/BLK offers remaining: ${verifyOffers.length}`);
    console.log(`Within-source duplicates remaining: ${withinDupes}`);
    console.log(`Cross-source duplicates remaining: ${crossDupes}`);
    console.log(withinDupes === 0 && crossDupes === 0 ? 'PASS: Zero duplicates.' : 'FAIL: Duplicates remain.');

    const after = await os(`/${INDEX}/_count`);
    console.log(`OpenSearch docs: ${after.count}`);
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
