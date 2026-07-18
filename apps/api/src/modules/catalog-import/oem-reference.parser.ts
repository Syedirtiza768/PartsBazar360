import { normalizeMasterName, normalizePartNumber } from './part-normalization.util';

export interface MakeAlias {
  canonicalName: string;
  aliases: string[];
  namespaceType?: 'VEHICLE_MAKE' | 'MANUFACTURER_GROUP';
}

export interface ParsedOemReference {
  raw: string;
  canonicalMake: string | null;
  matchedAlias: string | null;
  namespaceType: 'VEHICLE_MAKE' | 'MANUFACTURER_GROUP' | 'UNKNOWN';
  displayNumber: string;
  normalizedNumber: string;
  confidence: number;
  reviewReason?: string;
}

export const DEFAULT_MAKE_ALIASES: MakeAlias[] = [
  { canonicalName: 'Mercedes-Benz', aliases: ['MERCEDES-BENZ', 'MERCEDES BENZ', 'MERCEDES'] },
  { canonicalName: 'Land Rover', aliases: ['LAND ROVER', 'LANDROVER'] },
  { canonicalName: 'General Motors', aliases: ['GENERAL MOTORS', 'GM'], namespaceType: 'MANUFACTURER_GROUP' },
  { canonicalName: 'Volkswagen Group', aliases: ['VOLKSWAGEN GROUP', 'VAG'], namespaceType: 'MANUFACTURER_GROUP' },
  { canonicalName: 'Alfa Romeo', aliases: ['ALFA ROMEO'] },
  { canonicalName: 'Aston Martin', aliases: ['ASTON MARTIN'] },
  { canonicalName: 'Great Wall', aliases: ['GREAT WALL'] },
  { canonicalName: 'Rolls-Royce', aliases: ['ROLLS-ROYCE', 'ROLLS ROYCE'] },
  { canonicalName: 'Lynk & Co', aliases: ['LYNK & CO', 'LYNK AND CO'] },
  { canonicalName: 'Li Auto', aliases: ['LI AUTO', 'LIXIANG'] },
  { canonicalName: 'Toyota', aliases: ['TOYOTA'] },
  { canonicalName: 'Nissan', aliases: ['NISSAN'] },
  { canonicalName: 'Ford', aliases: ['FORD'] },
  { canonicalName: 'Mazda', aliases: ['MAZDA'] },
  { canonicalName: 'Honda', aliases: ['HONDA'] },
  { canonicalName: 'Hyundai', aliases: ['HYUNDAI'] },
  { canonicalName: 'Kia', aliases: ['KIA'] },
  { canonicalName: 'BMW', aliases: ['BMW'] },
  { canonicalName: 'Audi', aliases: ['AUDI'] },
  { canonicalName: 'Volkswagen', aliases: ['VOLKSWAGEN', 'VW'] },
  { canonicalName: 'Mitsubishi', aliases: ['MITSUBISHI'] },
  { canonicalName: 'Chrysler', aliases: ['CHRYSLER'] },
  { canonicalName: 'Subaru', aliases: ['SUBARU'] },
  { canonicalName: 'Lexus', aliases: ['LEXUS'] },
  { canonicalName: 'Porsche', aliases: ['PORSCHE'] },
  { canonicalName: 'Volvo', aliases: ['VOLVO'] },
  { canonicalName: 'Suzuki', aliases: ['SUZUKI'] },
  { canonicalName: 'Isuzu', aliases: ['ISUZU'] },
  { canonicalName: 'Renault', aliases: ['RENAULT'] },
  { canonicalName: 'Peugeot', aliases: ['PEUGEOT'] },
  { canonicalName: 'Citroen', aliases: ['CITROEN', 'CITROËN'] },
  { canonicalName: 'Fiat', aliases: ['FIAT'] },
  { canonicalName: 'Opel', aliases: ['OPEL'] },
  { canonicalName: 'Jeep', aliases: ['JEEP'] },
  { canonicalName: 'Dodge', aliases: ['DODGE'] },
  { canonicalName: 'Chevrolet', aliases: ['CHEVROLET'] },
  { canonicalName: 'Cadillac', aliases: ['CADILLAC'] },
  { canonicalName: 'Daewoo', aliases: ['DAEWOO'] },
  { canonicalName: 'Infiniti', aliases: ['INFINITI'] },
  { canonicalName: 'SsangYong', aliases: ['SSANGYONG'] },
  { canonicalName: 'BYD', aliases: ['BYD'] },
  { canonicalName: 'Geely', aliases: ['GEELY'] },
  { canonicalName: 'Lifan', aliases: ['LIFAN'] },
  { canonicalName: 'Hongqi', aliases: ['HONGQI'] },
  { canonicalName: 'GAC', aliases: ['GAC'] },
  { canonicalName: 'Jetour', aliases: ['JETOUR'] },
  { canonicalName: 'Samsung', aliases: ['SAMSUNG'] },
  { canonicalName: 'Belgee', aliases: ['BELGEE'] },
];

function aliasCandidates(masters: MakeAlias[]) {
  return masters
    .flatMap((master) => master.aliases.map((alias) => ({ master, alias, normalized: normalizeMasterName(alias) })))
    .sort((a, b) => b.normalized.length - a.normalized.length);
}

export function parseCompoundOemReferences(
  value: unknown,
  masters: MakeAlias[] = DEFAULT_MAKE_ALIASES,
): ParsedOemReference[] {
  const candidates = aliasCandidates(masters);
  const seen = new Set<string>();
  const results: ParsedOemReference[] = [];

  for (const token of String(value ?? '').split(/[,;\n]+/)) {
    const raw = token.trim();
    if (!raw) continue;
    const normalizedRaw = normalizeMasterName(raw);
    const match = candidates.find(({ normalized }) =>
      normalizedRaw === normalized || normalizedRaw.startsWith(`${normalized} `),
    );
    const displayNumber = match
      ? raw.slice(raw.toUpperCase().indexOf(match.alias.toUpperCase()) + match.alias.length).trim().replace(/^[-:]+\s*/, '')
      : raw;
    const normalizedNumber = normalizePartNumber(displayNumber);
    const key = `${match?.master.canonicalName ?? 'UNKNOWN'}:${normalizedNumber}`;
    if (!normalizedNumber || seen.has(key)) continue;
    seen.add(key);
    results.push({
      raw,
      canonicalMake: match?.master.canonicalName ?? null,
      matchedAlias: match?.alias ?? null,
      namespaceType: match?.master.namespaceType ?? (match ? 'VEHICLE_MAKE' : 'UNKNOWN'),
      displayNumber,
      normalizedNumber,
      confidence: match ? 0.98 : 0.2,
      reviewReason: match ? undefined : 'Unrecognized OEM make or manufacturer-group prefix',
    });
  }
  return results;
}
