/**
 * Prefer English marketplace titles from RealTrack / eBay Motors US payloads.
 */
export function extractEnglishTitle(listing: any): string {
  const candidates = [
    listing?.titleEn,
    listing?.englishTitle,
    listing?.localizedTitles?.en,
    listing?.localizedTitles?.EN,
    listing?.titles?.en,
    listing?.titles?.EN,
    listing?.marketplaceTitle,
    listing?.title,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return 'Unknown Part';
}

/**
 * Non-English automotive terms (Italian / French / German / Spanish) that
 * RealTrack SalvageA eBay US listings are titled in. RealTrack exposes no
 * `titleEn` field, so the only way to keep the marketplace English-only is to
 * skip listings whose title is written in another language. Terms are chosen
 * to not collide with English ("air"/"motor"/"filter"/"suspension"/"joint"
 * etc. are excluded).
 */
const NON_ENGLISH_TERMS = [
  // Italian
  'albero', 'coperchio', 'pompa', 'altoparlante', 'sterzo', 'cinghia',
  'motore', 'anteriore', 'posteriore', 'destra', 'sinistra', 'volant',
  'modanatura', 'passaruota', 'pannello', 'bilanciere', 'occasion',
  'schermo', 'portiera', 'cofano', 'parafango', 'sospension', 'frenata',
  'cremagliera', 'pignone', 'biella', 'boccola', 'raccordo', 'regolazione',
  'rinforzo', 'comando', 'braccio', 'inferiore', 'superiore', 'raccolta',
  'iniezione', 'secondaria', 'trasmissione', 'accessori', 'termostato',
  'cuscino', 'paraurti', 'specchio', 'fanale', 'asse', 'cambio',
  'scatola', 'tubo', 'olio', 'acqua', 'montante', 'cuscinetto',
  'ammortizzatore', 'tirante', 'barra', 'ponte', 'differenziale',
  'semiass', 'giunto', 'omocinetico', 'scudo', 'predellino', 'maniglia',
  'chiusura', 'serratura', 'cassetto', 'plancia', 'cruscotto',
  'climatizzatore', 'compressore', 'alternatore', 'motorino', 'centralina',
  'sensore', 'sonda', 'lambdasonda', 'candeletta', 'bobina', 'cavo',
  'fusibile', 'relè', 'relais', 'pompetta', 'collettore', 'aspirazione',
  'scarico', 'marmitta', 'silenzioso', 'longherone', 'traversa',
  'parabrezza', 'lunotto', 'finestrino', 'vetrino', 'vetro',
  'retrovisore', 'retrovisori', 'specchietto',
  'condotto', 'quadro', 'strumenti', 'presa', 'bocchettone', 'bocchetta',
  'flusso', 'miscela', 'soffietto', 'mantice', 'convogliatore', 'deflettore',
  'paraschizzi', 'paraspruzzi', 'copertura', 'guscio', 'carena', 'carenatura',
  'griglia', 'mascherina', 'calandra', 'fascione', 'listello', 'cornice',
  'portellone', 'portone', 'baule', 'vano', 'sfiato', 'scarico',
  // French
  'roue', 'pneu', 'capot', 'pare', 'choc', 'essu', 'glace', 'rétroviseur',
  'rétroviseurs', 'phares', 'pare-brise', 'hayon', 'aile', 'rotule',
  'roulement', 'bague', 'durit', 'refroid', 'clim', 'ventil', 'allume',
  'démarr', 'altern', 'batterie', 'frein', 'amort', 'ressort', 'coupelle',
  'biellette', 'essieu', 'triangul', 'bercage', 'flasque', 'moyeu',
  'cardan', 'homociné', 'boîte', 'boite', 'embrayage', 'vilebrequin',
  'soupape', 'injecteur', 'carburant', 'échappement', 'silencieux',
  'catalyseur', 'disque', 'étrier', 'étriers', 'plaquette', 'tambour',
  'amortisseur', 'ressorts', 'stabilisatrice', 'crémaillère', 'triangle',
  'roulement', 'pare-chocs', 'parechoc', 'caisse',
  'indicateur', 'changement', 'vitesse', 'automatique', 'manuelle',
  'clignotant', 'portière', 'coffre', 'banquette', 'garnissage',
  'habitacle', 'commodo', 'sélecteur', 'boîtier', 'calculateur',
  'carburateur', 'allumage', 'culasse', 'démarreur', 'différentiel',
  'butée', 'jante', 'pneumatique', 'flexible', 'tableau', 'commande',
  'cylindre', 'pédale', 'phare', 'feu', 'siège', 'levier', 'sonde',
  'capteur', 'bougie', 'câble', 'radiateur', 'refroidissement',
  'climatisation', 'compresseur',
  // German
  'getriebe', 'schaltung', 'hinter', 'vorder', 'lenk', 'brems', 'feder',
  'dämpf', 'stoß', 'stoss', 'abgas', 'auspuff', 'kotfl', 'tür', 'haube',
  'scheibe', 'scheinwerfer', 'rück', 'seiten', 'spiegel', 'kasten',
  'halter', 'lager', 'buchse', 'bolzen', 'nabe', 'achse', 'lenker',
  'stabil', 'quer', 'ölpumpe', 'wasserpumpe', 'zahnriemen', 'keilriemen',
  'kurbel', 'nocken', 'zylinder', 'kolben', 'pleuel', 'ventil', 'zünd',
  'einspritz', 'kraftstoff', 'luftfilter', 'ölkühler', 'bremsscheibe',
  'bremse', 'handbremse', 'antriebswelle', 'gelenk', 'kupplung',
  'differenzial', 'gebraucht', 'motorhaube', 'kotflügel', 'stoßstange',
  'stoßfänger', 'seitenspiegel', 'rückspiegel', 'außenspiegel',
  'sitzheizung', 'bremssattel', 'bremsbelag', 'bremsschlauch', 'lenkrad',
  'lenksäule', 'lenkgetriebe', 'lenkstockhebel', 'schaltgestänge',
  'kupplungsnehmer', 'kupplungsgeber', 'anlasser', 'lichtmaschine',
  'zündkerze', 'zündspule', 'zündverteiler', 'einspritzdüse',
  'kraftstoffpumpe', 'luftfiltergehäuse', 'ölkühler', 'krümmer',
  'auspuffkrümmer', 'endtopf', 'katalysator', 'hinterachse',
  'vorderachse', 'querlenker', 'längslenker', 'stabilisator',
  'schraubenfeder', 'stoßdämpfer', 'radlager', 'radnabe', 'achslenker',
  // Spanish
  'rueda', 'neumático', 'parachoques', 'paragolpes', 'espejo', 'farol',
  'guardabarro', 'aleta', 'puerta', 'maletero', 'cofre', 'volante',
  'dirección', 'amortiguador', 'muelle', 'suspensión', 'mangueta',
  'rótula', 'rodamiento', 'embrague', 'cigüeñal', 'inyector', 'filtro',
  'silenciador', 'pinza', 'pastilla', 'cubierta', 'manillar',
];

const NON_ENGLISH_RE = new RegExp(`\\b(${NON_ENGLISH_TERMS.join('|')})\\b`, 'i');

/** True when title looks predominantly Latin/English (not CJK / heavy Cyrillic). */
export function looksLikeEnglishTitle(title: string): boolean {
  const s = String(title || '').trim();
  if (!s) return false;
  const letters = s.replace(/[^A-Za-z\u00C0-\u024F]/g, '');
  const nonLatin = s.replace(/[\x00-\x7F\u00C0-\u024F\s0-9.,\-/()#&+'"]/g, '');
  if (letters.length < 3) return false;
  if (nonLatin.length / Math.max(s.length, 1) >= 0.25) return false;
  // Romance / Germanic automotive terms ⇒ not an English title.
  if (NON_ENGLISH_RE.test(s)) return false;
  return true;
}
