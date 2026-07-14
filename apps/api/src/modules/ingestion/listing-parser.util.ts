/**
 * Heuristic parsing helpers for normalizing raw RealTrack/eBay listing titles
 * into brand/category/vehicle/OE-number hints. These are best-effort
 * extractions from free-text, multi-language titles (English/German/French/
 * Spanish), not verified OE fitment data — every auto-created Fitment is
 * tagged evidenceLevel 'D' (unverified) so it can be distinguished from
 * manually-reviewed fitment data.
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Engine: ['engine', 'motor', 'cylinder', 'piston', 'crankshaft', 'camshaft', 'intake manifold'],
  Transmission: ['trans ', 'transmission', 'gearbox', 'differential', 'clutch', 'torque converter', 'getriebe'],
  Brakes: ['brake', 'caliper', 'rotor', 'brake pad'],
  Suspension: ['suspension', 'shock', 'strut', 'spring', 'control arm', 'sway bar'],
  Electrical: ['ecu', 'module', 'sensor', 'wiring', 'harness', 'alternator', 'battery', 'fuse box'],
  Body: ['bumper', 'fender', 'door ', 'hood', 'mirror', 'grille', 'panel', 'trunk', 'tailgate', 'stoßstange', 'parachoques'],
  Interior: ['seat', 'dashboard', 'console', 'airbag', 'steering wheel'],
  Wheels: ['wheel', 'rim ', 'tire', 'hubcap'],
  Cooling: ['radiator', 'cooling fan', 'water pump'],
  Exhaust: ['exhaust', 'muffler', 'catalytic'],
};

export function extractCategory(title: string): string {
  const lower = title.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return 'General';
}

export interface ParsedVehicle {
  startYear: number;
  endYear: number;
  make: string;
  model: string;
}

// Longer/multi-word aliases must be listed before the shorter ones they contain
// (e.g. "Land Rover" before "Range Rover") so the leftmost-match scan below
// prefers the more specific brand name.
const MAKE_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'Land Rover', aliases: ['Land Rover'] },
  { canonical: 'Range Rover', aliases: ['Range Rover'] },
  { canonical: 'Mercedes-Benz', aliases: ['Mercedes-Benz', 'Mercedes Benz', 'Mercedes'] },
  { canonical: 'Alfa Romeo', aliases: ['Alfa Romeo'] },
  { canonical: 'Aston Martin', aliases: ['Aston Martin'] },
  { canonical: 'Rolls-Royce', aliases: ['Rolls-Royce', 'Rolls Royce'] },
  { canonical: 'Volkswagen', aliases: ['Volkswagen', 'VW'] },
  { canonical: 'BMW', aliases: ['BMW'] },
  { canonical: 'Audi', aliases: ['Audi'] },
  { canonical: 'Ford', aliases: ['Ford'] },
  { canonical: 'Kia', aliases: ['Kia'] },
  { canonical: 'Jeep', aliases: ['Jeep'] },
  { canonical: 'Lexus', aliases: ['Lexus'] },
  { canonical: 'Toyota', aliases: ['Toyota'] },
  { canonical: 'Honda', aliases: ['Honda'] },
  { canonical: 'Nissan', aliases: ['Nissan'] },
  { canonical: 'Mazda', aliases: ['Mazda'] },
  { canonical: 'Porsche', aliases: ['Porsche'] },
  { canonical: 'Jaguar', aliases: ['Jaguar'] },
  { canonical: 'Bentley', aliases: ['Bentley'] },
  { canonical: 'Mini', aliases: ['MINI', 'Mini'] },
  { canonical: 'Dodge', aliases: ['Dodge'] },
  { canonical: 'Chrysler', aliases: ['Chrysler'] },
  { canonical: 'Chevrolet', aliases: ['Chevrolet', 'Chevy'] },
  { canonical: 'GMC', aliases: ['GMC'] },
  { canonical: 'Cadillac', aliases: ['Cadillac'] },
  { canonical: 'Buick', aliases: ['Buick'] },
  { canonical: 'Hyundai', aliases: ['Hyundai'] },
  { canonical: 'Subaru', aliases: ['Subaru'] },
  { canonical: 'Volvo', aliases: ['Volvo'] },
  { canonical: 'Fiat', aliases: ['Fiat'] },
  { canonical: 'Peugeot', aliases: ['Peugeot'] },
  { canonical: 'Renault', aliases: ['Renault'] },
  { canonical: 'Skoda', aliases: ['Skoda', 'Škoda'] },
  { canonical: 'Seat', aliases: ['SEAT'] },
  { canonical: 'Opel', aliases: ['Opel'] },
  { canonical: 'Vauxhall', aliases: ['Vauxhall'] },
  { canonical: 'Infiniti', aliases: ['Infiniti'] },
  { canonical: 'Acura', aliases: ['Acura'] },
  { canonical: 'Mitsubishi', aliases: ['Mitsubishi'] },
  { canonical: 'Suzuki', aliases: ['Suzuki'] },
  { canonical: 'Ferrari', aliases: ['Ferrari'] },
  { canonical: 'Lamborghini', aliases: ['Lamborghini'] },
  { canonical: 'Maserati', aliases: ['Maserati'] },
  { canonical: 'Smart', aliases: ['Smart'] },
  { canonical: 'Saab', aliases: ['Saab'] },
  { canonical: 'Citroen', aliases: ['Citroen', 'Citroën'] },
  { canonical: 'Isuzu', aliases: ['Isuzu'] },
  { canonical: 'Genesis', aliases: ['Genesis'] },
  { canonical: 'Tesla', aliases: ['Tesla'] },
  { canonical: 'Ram', aliases: ['RAM'] },
  { canonical: 'Scion', aliases: ['Scion'] },
  { canonical: 'Lincoln', aliases: ['Lincoln'] },
];

// Words that show up immediately after a make name but are never part of a
// model name — condition/part-descriptor/preposition noise across the
// languages seen in the source titles (English/German/French/Spanish).
const MODEL_STOPWORDS = new Set(
  [
    'used', 'new', 'oem', 'oe', 'gebraucht', 'bj', 'occasion', "d'occasion",
    'front', 'rear', 'right', 'left', 'upper', 'lower', 'inner', 'outer',
    'inside', 'outside', 'complete', 'assembly', 'set', 'kit', 'pair',
    'genuine', 'original', 'aftermarket', 'replacement', 'für', 'with',
    'ohne', 'mit', 'and', 'the', 'a', 'an', 'of', 'for', 'to', 'from',
    'element', 'de', 'trasera', 'delantero', 'delantera', 'derecha',
    'izquierda', 'droit', 'gauche', 'avant', 'arrière', 'hinten', 'vorne',
    'links', 'innen', 'alignment', 'heavy', 'duty', 'truck', 'guard',
    'cover', 'clip', 'bolt', 'nut', 'screw', 'cable', 'hose', 'pipe',
    'tube', 'gasket', 'filter', 'pump', 'valve', 'relay', 'connector',
    'plug', 'socket', 'bezel', 'molding', 'moulding', 'garnish', 'spoiler',
    'visor', 'emblem', 'badge', 'mat', 'liner', 'tray', 'box', 'holder',
    'cluster', 'unit', 'control', 'remote', 'player', 'radio',
    'navigation', 'navigationssystem', 'gps', 'dvd', 'cd', 'system', 'head',
    ...Object.values(CATEGORY_KEYWORDS)
      .flat()
      .flatMap((kw) => kw.trim().split(/\s+/)),
  ].map((w) => w.toLowerCase()),
);

// A handful of common two-word model names, keyed by the lowercased first
// word, so we don't over-eagerly glue every following noun onto the model.
const TWO_WORD_MODEL_CONTINUATIONS: Record<string, string> = {
  santa: 'fe',
  grand: 'cherokee',
  range: 'rover',
  land: 'cruiser',
};

const YEAR_RANGE_PATTERN = /\b(19[5-9]\d|20[0-4]\d)\s*[-–—]\s*(19[5-9]\d|20[0-4]\d)\b/;
const YEAR_SINGLE_PATTERN = /\b(19[5-9]\d|20[0-4]\d)\b/;

function findYearRange(title: string): { startYear: number; endYear: number } | null {
  const rangeMatch = title.match(YEAR_RANGE_PATTERN);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    return { startYear: Math.min(a, b), endYear: Math.max(a, b) };
  }
  const singleMatch = title.match(YEAR_SINGLE_PATTERN);
  if (singleMatch) {
    const year = parseInt(singleMatch[1], 10);
    return { startYear: year, endYear: year };
  }
  return null;
}

function findMake(title: string): { canonical: string; index: number; length: number } | null {
  let best: { canonical: string; index: number; length: number } | null = null;
  for (const { canonical, aliases } of MAKE_ALIASES) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      const match = title.match(re);
      if (match && match.index !== undefined) {
        if (!best || match.index < best.index) {
          best = { canonical, index: match.index, length: match[0].length };
        }
      }
    }
  }
  return best;
}

function looksLikePartCode(token: string): boolean {
  const hasDigit = /\d/.test(token);
  const hasLetter = /[A-Za-z]/.test(token);
  return hasDigit && hasLetter && token.length >= 6;
}

function isDisqualifiedModelToken(cleaned: string): boolean {
  if (!cleaned) return true;
  const lower = cleaned.toLowerCase();
  if (MODEL_STOPWORDS.has(lower)) return true;
  if (/^(19[5-9]\d|20[0-4]\d)$/.test(cleaned)) return true; // bare year
  if (YEAR_RANGE_PATTERN.test(cleaned)) return true; // "2011-2018" glued as one token
  if (/^\d+$/.test(cleaned) && cleaned.length >= 3) return true; // numeric code
  if (looksLikePartCode(cleaned)) return true; // e.g. "4L0805697"
  return false;
}

// Deliberately conservative: only the immediate next word is treated as the
// model, expanded to a known two-word model name when recognized. This
// trades a little recall for much higher precision, since every fitment
// produced here is auto-inferred and unverified (evidenceLevel 'D').
function extractModel(title: string, makeIndex: number, makeLength: number): string | null {
  const rest = title.slice(makeIndex + makeLength);
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0].replace(/^[/,;:()]+|[/,;:()]+$/g, '');
  if (isDisqualifiedModelToken(first)) return null;

  let model = first;
  const continuation = TWO_WORD_MODEL_CONTINUATIONS[first.toLowerCase()];
  if (continuation && tokens[1]) {
    const second = tokens[1].replace(/^[/,;:()]+|[/,;:()]+$/g, '');
    if (second.toLowerCase() === continuation) {
      model = `${first} ${second}`;
    }
  }

  if (model.length < 1 || model.length > 30) return null;
  return model;
}

export function parseVehicleFromTitle(title: string): ParsedVehicle | null {
  const make = findMake(title);
  if (!make) return null;

  const model = extractModel(title, make.index, make.length);
  if (!model) return null;

  const years = findYearRange(title);
  if (!years) return null;

  return {
    startYear: years.startYear,
    endYear: years.endYear,
    make: make.canonical,
    model,
  };
}

// Matches an explicit "OEM <code>" / "OE# <code>" annotation, which is the
// highest-confidence signal for an OE part number in these titles.
const OEM_PREFIXED_PATTERN = /\bOEM?\.?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,16})\b/gi;
const GENERIC_CODE_PATTERN = /\b[A-Za-z0-9][A-Za-z0-9-]{4,15}[A-Za-z0-9]\b/g;

export function extractOeNumbers(title: string): string[] {
  const codes = new Set<string>();

  let match: RegExpExecArray | null;
  OEM_PREFIXED_PATTERN.lastIndex = 0;
  while ((match = OEM_PREFIXED_PATTERN.exec(title))) {
    codes.add(match[1].toUpperCase());
  }

  const generic = title.match(GENERIC_CODE_PATTERN) || [];
  for (const token of generic) {
    const isYear = /^(19[5-9]\d|20[0-4]\d)$/.test(token);
    if (!isYear && looksLikePartCode(token) && token.length >= 6) {
      codes.add(token.toUpperCase());
    }
  }

  return Array.from(codes).slice(0, 4);
}
