/**
 * Curated automotive vocabulary for deterministic query understanding.
 *
 * Deliberately curated rather than derived from the database. The production
 * `VehicleMake` table contains case-duplicates (AUDI/Audi, KIA/Kia, FORD/Ford),
 * non-makes (`Accent`, `Trooper`, `Partner`, `D-max`), and holding-company
 * names (`Volkswagen Group`, `General Motors`); `VehicleModel` contains
 * `"Tiguan`, `&quot;Tiguan`, `-BORA`, `.`, `2.0L`, `12V`, `2-PIN`. Parsing
 * against that data would produce wrong extractions.
 *
 * See docs/SEARCH_PHASE1_AUDIT.md §4 RC-5.
 */

export type Side = 'LEFT' | 'RIGHT';
export type Position =
  | 'FRONT'
  | 'REAR'
  | 'UPPER'
  | 'LOWER'
  | 'INNER'
  | 'OUTER'
  | 'CENTER';
export type Condition = 'NEW' | 'USED' | 'REMANUFACTURED' | 'REFURBISHED';

/** Canonical make → every spelling a buyer or seller might type. */
export const MAKE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Alfa Romeo': ['alfa romeo', 'alfa', 'alfaromeo'],
  'Aston Martin': ['aston martin', 'aston'],
  Audi: ['audi'],
  BMW: ['bmw', 'bimmer'],
  Bentley: ['bentley'],
  Buick: ['buick'],
  Cadillac: ['cadillac', 'caddy'],
  Chevrolet: ['chevrolet', 'chevy', 'chev'],
  Chrysler: ['chrysler'],
  Citroen: ['citroen', 'citroën'],
  Dacia: ['dacia'],
  Daihatsu: ['daihatsu'],
  Dodge: ['dodge'],
  Ferrari: ['ferrari'],
  Fiat: ['fiat'],
  Ford: ['ford'],
  GMC: ['gmc'],
  Genesis: ['genesis'],
  Honda: ['honda'],
  Hummer: ['hummer'],
  Hyundai: ['hyundai'],
  Infiniti: ['infiniti', 'infinity'],
  Isuzu: ['isuzu'],
  Jaguar: ['jaguar', 'jag'],
  Jeep: ['jeep'],
  Kia: ['kia'],
  Lamborghini: ['lamborghini', 'lambo'],
  'Land Rover': ['land rover', 'landrover', 'range rover', 'rangerover'],
  Lexus: ['lexus'],
  Lincoln: ['lincoln'],
  MG: ['mg'],
  Maserati: ['maserati'],
  Mazda: ['mazda'],
  'Mercedes-Benz': ['mercedes-benz', 'mercedes', 'merc', 'benz', 'mercedes benz'],
  Mini: ['mini', 'mini cooper'],
  Mitsubishi: ['mitsubishi', 'mitsu'],
  Nissan: ['nissan', 'datsun'],
  Opel: ['opel'],
  Peugeot: ['peugeot'],
  Porsche: ['porsche'],
  Ram: ['ram'],
  Renault: ['renault'],
  'Rolls-Royce': ['rolls-royce', 'rolls royce', 'rollsroyce'],
  Saab: ['saab'],
  Seat: ['seat cupra', 'cupra'],
  Skoda: ['skoda', 'škoda'],
  Smart: ['smart car'],
  Subaru: ['subaru', 'subie'],
  Suzuki: ['suzuki'],
  Tesla: ['tesla'],
  Toyota: ['toyota'],
  Vauxhall: ['vauxhall'],
  Volkswagen: ['volkswagen', 'vw', 'volkswagon'],
  Volvo: ['volvo'],
};

/**
 * High-frequency models, scoped to their make so "Civic" cannot resolve to
 * Toyota. Only models we are confident about — an unrecognised token stays in
 * the free-text portion rather than being guessed at.
 */
export const MODELS_BY_MAKE: Readonly<Record<string, readonly string[]>> = {
  Audi: ['a1', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'q3', 'q5', 'q7', 'q8', 'tt', 'rs3', 'rs6', 's3', 's4', 'e-tron'],
  BMW: ['1 series', '2 series', '3 series', '4 series', '5 series', '6 series', '7 series', 'x1', 'x3', 'x4', 'x5', 'x6', 'x7', 'z4', 'i3', 'i8', 'm3', 'm4', 'm5'],
  Chevrolet: ['camaro', 'corvette', 'cruze', 'equinox', 'impala', 'malibu', 'silverado', 'suburban', 'tahoe', 'traverse'],
  Dodge: ['challenger', 'charger', 'durango', 'journey', 'ram'],
  Ford: ['bronco', 'edge', 'escape', 'expedition', 'explorer', 'f-150', 'f150', 'fiesta', 'focus', 'fusion', 'mustang', 'ranger', 'transit'],
  Honda: ['accord', 'civic', 'cr-v', 'crv', 'fit', 'hr-v', 'hrv', 'odyssey', 'pilot', 'ridgeline'],
  Hyundai: ['accent', 'elantra', 'i10', 'i20', 'i30', 'kona', 'santa fe', 'sonata', 'tucson'],
  Jaguar: ['e-pace', 'f-pace', 'f-type', 'xe', 'xf', 'xj'],
  Jeep: ['cherokee', 'compass', 'grand cherokee', 'gladiator', 'renegade', 'wrangler'],
  Kia: ['carnival', 'forte', 'optima', 'rio', 'seltos', 'sorento', 'soul', 'sportage', 'stinger'],
  'Land Rover': ['defender', 'discovery', 'evoque', 'freelander', 'range rover sport', 'velar'],
  Lexus: ['es', 'gs', 'gx', 'is', 'lc', 'ls', 'lx', 'nx', 'rc', 'rx', 'ux'],
  Mazda: ['cx-3', 'cx-5', 'cx-9', 'mazda3', 'mazda6', 'mx-5', 'miata'],
  'Mercedes-Benz': ['a-class', 'b-class', 'c-class', 'e-class', 's-class', 'cla', 'cls', 'gla', 'glb', 'glc', 'gle', 'gls', 'sl', 'slk', 'sprinter', 'g-wagon'],
  Mini: ['clubman', 'countryman', 'cooper'],
  Mitsubishi: ['asx', 'eclipse', 'lancer', 'outlander', 'pajero'],
  Nissan: ['altima', 'armada', 'frontier', 'gt-r', 'juke', 'leaf', 'maxima', 'murano', 'navara', 'pathfinder', 'patrol', 'qashqai', 'rogue', 'sentra', 'versa', 'x-trail', '370z'],
  Porsche: ['911', 'boxster', 'cayenne', 'cayman', 'macan', 'panamera', 'taycan'],
  Subaru: ['brz', 'crosstrek', 'forester', 'impreza', 'legacy', 'outback', 'wrx'],
  Toyota: ['4runner', 'avalon', 'camry', 'corolla', 'fortuner', 'highlander', 'hilux', 'land cruiser', 'prado', 'prius', 'rav4', 'sequoia', 'sienna', 'supra', 'tacoma', 'tundra', 'yaris', 'hiace'],
  Volkswagen: ['arteon', 'atlas', 'beetle', 'bora', 'golf', 'jetta', 'passat', 'polo', 'scirocco', 'tiguan', 'touareg', 'touran'],
  Volvo: ['s60', 's90', 'v40', 'v60', 'v90', 'xc40', 'xc60', 'xc90'],
};

/**
 * Chassis / platform codes. These are how enthusiasts search ("BMW F10 gear
 * selector", "W221 blower"). Mapped to their make so they also imply it.
 */
export const CHASSIS_CODES: Readonly<Record<string, { make: string; label: string }>> = {
  e30: { make: 'BMW', label: 'E30' }, e36: { make: 'BMW', label: 'E36' },
  e39: { make: 'BMW', label: 'E39' }, e46: { make: 'BMW', label: 'E46' },
  e60: { make: 'BMW', label: 'E60' }, e70: { make: 'BMW', label: 'E70' },
  e90: { make: 'BMW', label: 'E90' }, e91: { make: 'BMW', label: 'E91' },
  e92: { make: 'BMW', label: 'E92' }, f10: { make: 'BMW', label: 'F10' },
  f11: { make: 'BMW', label: 'F11' }, f20: { make: 'BMW', label: 'F20' },
  f30: { make: 'BMW', label: 'F30' }, f31: { make: 'BMW', label: 'F31' },
  g20: { make: 'BMW', label: 'G20' }, g30: { make: 'BMW', label: 'G30' },
  w123: { make: 'Mercedes-Benz', label: 'W123' }, w124: { make: 'Mercedes-Benz', label: 'W124' },
  w140: { make: 'Mercedes-Benz', label: 'W140' }, w163: { make: 'Mercedes-Benz', label: 'W163' },
  w164: { make: 'Mercedes-Benz', label: 'W164' }, w166: { make: 'Mercedes-Benz', label: 'W166' },
  w176: { make: 'Mercedes-Benz', label: 'W176' }, w203: { make: 'Mercedes-Benz', label: 'W203' },
  w204: { make: 'Mercedes-Benz', label: 'W204' }, w205: { make: 'Mercedes-Benz', label: 'W205' },
  w211: { make: 'Mercedes-Benz', label: 'W211' }, w212: { make: 'Mercedes-Benz', label: 'W212' },
  w221: { make: 'Mercedes-Benz', label: 'W221' }, w222: { make: 'Mercedes-Benz', label: 'W222' },
  w251: { make: 'Mercedes-Benz', label: 'W251' },
  mk4: { make: 'Volkswagen', label: 'MK4' }, mk5: { make: 'Volkswagen', label: 'MK5' },
  mk6: { make: 'Volkswagen', label: 'MK6' }, mk7: { make: 'Volkswagen', label: 'MK7' },
  b8: { make: 'Audi', label: 'B8' }, c7: { make: 'Audi', label: 'C7' },
};

/** Side markers. "LH"/"RH" are the dominant trade abbreviations. */
export const SIDE_TERMS: Readonly<Record<string, Side>> = {
  lh: 'LEFT', 'l/h': 'LEFT', left: 'LEFT', 'left-hand': 'LEFT', 'left hand': 'LEFT',
  driver: 'LEFT', "driver's": 'LEFT', 'driver side': 'LEFT', 'drivers side': 'LEFT', nearside: 'LEFT',
  rh: 'RIGHT', 'r/h': 'RIGHT', right: 'RIGHT', 'right-hand': 'RIGHT', 'right hand': 'RIGHT',
  passenger: 'RIGHT', 'passenger side': 'RIGHT', offside: 'RIGHT',
};

export const POSITION_TERMS: Readonly<Record<string, Position>> = {
  front: 'FRONT', fr: 'FRONT', forward: 'FRONT',
  rear: 'REAR', back: 'REAR', rr: 'REAR',
  upper: 'UPPER', top: 'UPPER',
  lower: 'LOWER', bottom: 'LOWER',
  inner: 'INNER', inside: 'INNER',
  outer: 'OUTER', outside: 'OUTER',
  center: 'CENTER', centre: 'CENTER', middle: 'CENTER',
};

export const CONDITION_TERMS: Readonly<Record<string, Condition>> = {
  new: 'NEW', brandnew: 'NEW', 'brand new': 'NEW',
  used: 'USED', 'second hand': 'USED', secondhand: 'USED', salvage: 'USED', pulled: 'USED',
  reman: 'REMANUFACTURED', remanufactured: 'REMANUFACTURED', rebuilt: 'REMANUFACTURED',
  refurbished: 'REFURBISHED', refurb: 'REFURBISHED', reconditioned: 'REFURBISHED',
};

/**
 * Automotive synonym groups (brief §7). Every term in a group is treated as
 * equivalent at query time. Kept flat and data-shaped so it can move to the
 * `SearchSynonym` table without changing the consumer.
 *
 * Ordering within a group is irrelevant; the first entry is the label used in
 * the query-interpretation response.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['gear selector', 'shifter', 'shift assembly', 'gear shifter', 'selector lever'],
  ['tail light', 'taillight', 'tail lamp', 'taillamp', 'rear lamp', 'rear light'],
  ['headlight', 'head light', 'headlamp', 'head lamp', 'front light'],
  ['fog light', 'foglight', 'fog lamp', 'foglamp'],
  ['ecu', 'ecm', 'engine computer', 'engine control unit', 'engine control module'],
  ['tcm', 'transmission control module', 'gearbox computer'],
  ['abs module', 'abs pump', 'abs control unit', 'anti-lock brake module'],
  ['bumper cover', 'bumper skin', 'bumper fascia'],
  ['hood', 'bonnet'],
  ['trunk', 'boot', 'tailgate', 'liftgate'],
  ['fender', 'wing', 'guard'],
  ['windshield', 'windscreen'],
  ['control arm', 'wishbone', 'a-arm', 'track control arm'],
  ['lane camera', 'adas camera', 'forward facing camera', 'lane departure camera', 'lane assist camera'],
  ['shock absorber', 'shock', 'damper', 'strut'],
  ['muffler', 'silencer', 'exhaust box'],
  ['alternator', 'generator', 'dynamo'],
  ['starter', 'starter motor', 'self starter'],
  ['radiator fan', 'cooling fan', 'engine fan'],
  ['ac compressor', 'a/c compressor', 'air conditioning compressor', 'aircon compressor'],
  ['catalytic converter', 'cat converter', 'cat'],
  ['side mirror', 'wing mirror', 'door mirror', 'rear view mirror exterior'],
  ['cv joint', 'constant velocity joint', 'drive shaft joint'],
  ['wheel bearing', 'hub bearing', 'bearing hub'],
  ['brake pad', 'brake pads', 'disc pad'],
  ['brake disc', 'brake rotor', 'rotor', 'brake disk'],
  ['spark plug', 'sparkplug', 'ignition plug'],
  ['ignition coil', 'coil pack', 'spark coil'],
  ['fuel pump', 'petrol pump', 'gas pump'],
  ['air filter', 'air cleaner element'],
  ['power steering pump', 'ps pump', 'steering pump'],
  ['turbocharger', 'turbo', 'turbo charger'],
  ['intercooler', 'charge air cooler'],
  ['throttle body', 'throttle valve'],
  ['mass air flow sensor', 'maf sensor', 'air flow meter', 'afm'],
  ['oxygen sensor', 'o2 sensor', 'lambda sensor'],
  ['crankshaft position sensor', 'ckp sensor', 'crank sensor'],
  ['timing belt', 'cambelt', 'cam belt'],
  ['serpentine belt', 'drive belt', 'accessory belt', 'fan belt'],
  ['engine mount', 'motor mount', 'engine mounting'],
  ['radiator', 'water cooler', 'engine radiator'],
  ['water pump', 'coolant pump'],
  ['steering rack', 'steering gear', 'rack and pinion'],
  ['tie rod', 'track rod', 'steering rod'],
  ['sway bar', 'anti roll bar', 'stabilizer bar', 'stabiliser bar'],
  ['glove box', 'glovebox', 'glove compartment'],
  ['sun visor', 'sunvisor'],
  ['door handle', 'door grip'],
  ['wiper motor', 'windshield wiper motor', 'windscreen wiper motor'],
  ['instrument cluster', 'speedometer', 'dash cluster', 'gauge cluster'],
  ['steering wheel', 'steering'],
  ['seat belt', 'seatbelt', 'safety belt'],
  ['air bag', 'airbag', 'srs airbag'],
];

/** Lowercased term → its synonym group (including itself). Built once. */
export const SYNONYM_INDEX: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) map.set(term.toLowerCase(), group);
  }
  return map;
})();

/** Alias → canonical make. Built once from MAKE_ALIASES. */
export const MAKE_LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(MAKE_ALIASES)) {
    map.set(canonical.toLowerCase(), canonical);
    for (const alias of aliases) map.set(alias.toLowerCase(), canonical);
  }
  return map;
})();

/** Model → canonical make. Built once from MODELS_BY_MAKE. */
export const MODEL_LOOKUP: ReadonlyMap<string, { make: string; model: string }> = (() => {
  const map = new Map<string, { make: string; model: string }>();
  for (const [make, models] of Object.entries(MODELS_BY_MAKE)) {
    for (const model of models) {
      // First writer wins so an ambiguous name keeps its most common make.
      if (!map.has(model)) map.set(model, { make, model });
    }
  }
  return map;
})();

/** Longest multi-word keys first, so "land rover" beats "rover". */
export function multiWordKeys(source: Iterable<string>): string[] {
  return [...source]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
}
