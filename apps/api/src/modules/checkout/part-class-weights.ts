/**
 * Part-class shipping profiles.
 *
 * Most of the catalog has no seller-supplied weight. Quoting those at a flat
 * 1kg badly under-charges anything larger than a sensor, so every part resolves
 * to a class profile that supplies a plausible median weight, typical packed
 * dimensions, and a min/max envelope used to clamp AI-estimated weights.
 *
 * Note: `CanonicalPart.partType` is a provenance classification (GENUINE_OEM,
 * SALVAGE_OEM, …), not a functional category, so resolution keys on the coarse
 * `category` plus title keywords instead.
 */

export interface PartClassProfile {
  key: string;
  /** Coarse `CanonicalPart.category` this class rolls up into. */
  category: string;
  medianWeightKg: number;
  minWeightKg: number;
  maxWeightKg: number;
  /** Typical packed carton, used for volumetric weight when real dims are absent. */
  typicalDimsCm: { l: number; w: number; h: number };
  /** True when volumetric weight normally exceeds actual weight for this class. */
  volumetricDominant: boolean;
  /** Title keywords; the longest match across all classes wins. */
  keywords: string[];
}

const PROFILES: PartClassProfile[] = [
  // ── Brakes ────────────────────────────────────────────────────────────────
  {
    key: 'BRAKE_PAD_SET',
    category: 'Brakes',
    medianWeightKg: 1.6,
    minWeightKg: 0.5,
    maxWeightKg: 5,
    typicalDimsCm: { l: 22, w: 14, h: 8 },
    volumetricDominant: false,
    keywords: ['brake pad', 'brake pads', 'pad set', 'bremsbel'],
  },
  {
    key: 'BRAKE_DISC_ROTOR',
    category: 'Brakes',
    medianWeightKg: 8.5,
    minWeightKg: 2.5,
    maxWeightKg: 22,
    typicalDimsCm: { l: 34, w: 34, h: 10 },
    volumetricDominant: false,
    keywords: ['brake disc', 'brake rotor', 'brake discs', 'rotor', 'bremsscheibe'],
  },
  {
    key: 'BRAKE_CALIPER',
    category: 'Brakes',
    medianWeightKg: 4.5,
    minWeightKg: 1.5,
    maxWeightKg: 12,
    typicalDimsCm: { l: 26, w: 20, h: 16 },
    volumetricDominant: false,
    keywords: ['brake caliper', 'caliper', 'bremssattel'],
  },
  {
    key: 'BRAKE_MASTER_CYLINDER',
    category: 'Brakes',
    medianWeightKg: 1.8,
    minWeightKg: 0.6,
    maxWeightKg: 5,
    typicalDimsCm: { l: 28, w: 16, h: 14 },
    volumetricDominant: false,
    keywords: ['master cylinder', 'brake booster', 'wheel cylinder'],
  },
  {
    key: 'ABS_PUMP',
    category: 'Brakes',
    medianWeightKg: 3.2,
    minWeightKg: 1,
    maxWeightKg: 7,
    typicalDimsCm: { l: 25, w: 20, h: 18 },
    volumetricDominant: false,
    keywords: ['abs pump', 'abs module', 'abs unit', 'hydraulic unit'],
  },
  {
    key: 'BRAKE_HOSE_LINE',
    category: 'Brakes',
    medianWeightKg: 0.4,
    minWeightKg: 0.05,
    maxWeightKg: 2,
    typicalDimsCm: { l: 30, w: 18, h: 6 },
    volumetricDominant: true,
    keywords: ['brake hose', 'brake line', 'brake cable', 'handbrake cable'],
  },

  // ── Engine ────────────────────────────────────────────────────────────────
  {
    key: 'ENGINE_ASSEMBLY',
    category: 'Engine',
    medianWeightKg: 160,
    minWeightKg: 60,
    maxWeightKg: 450,
    typicalDimsCm: { l: 90, w: 80, h: 75 },
    volumetricDominant: false,
    keywords: ['engine assembly', 'complete engine', 'engine long block', 'bare engine', 'motor assembly'],
  },
  {
    key: 'ENGINE_BLOCK',
    category: 'Engine',
    medianWeightKg: 75,
    minWeightKg: 25,
    maxWeightKg: 200,
    typicalDimsCm: { l: 70, w: 55, h: 50 },
    volumetricDominant: false,
    keywords: ['engine block', 'cylinder block', 'short block'],
  },
  {
    key: 'CYLINDER_HEAD',
    category: 'Engine',
    medianWeightKg: 22,
    minWeightKg: 6,
    maxWeightKg: 60,
    typicalDimsCm: { l: 62, w: 32, h: 26 },
    volumetricDominant: false,
    keywords: ['cylinder head', 'zylinderkopf'],
  },
  {
    key: 'CRANKSHAFT',
    category: 'Engine',
    medianWeightKg: 20,
    minWeightKg: 6,
    maxWeightKg: 55,
    typicalDimsCm: { l: 80, w: 22, h: 22 },
    volumetricDominant: false,
    keywords: ['crankshaft', 'crank shaft', 'kurbelwelle'],
  },
  {
    key: 'CAMSHAFT',
    category: 'Engine',
    medianWeightKg: 6,
    minWeightKg: 1.5,
    maxWeightKg: 18,
    typicalDimsCm: { l: 62, w: 14, h: 14 },
    volumetricDominant: false,
    keywords: ['camshaft', 'cam shaft', 'nockenwelle'],
  },
  {
    key: 'PISTON_SET',
    category: 'Engine',
    medianWeightKg: 2.2,
    minWeightKg: 0.3,
    maxWeightKg: 10,
    typicalDimsCm: { l: 26, w: 20, h: 14 },
    volumetricDominant: false,
    keywords: ['piston', 'piston set', 'piston ring', 'kolben'],
  },
  {
    key: 'TURBOCHARGER',
    category: 'Engine',
    medianWeightKg: 9,
    minWeightKg: 3,
    maxWeightKg: 28,
    typicalDimsCm: { l: 34, w: 30, h: 28 },
    volumetricDominant: false,
    keywords: ['turbocharger', 'turbo charger', 'supercharger', 'turbolader'],
  },
  {
    key: 'INTAKE_MANIFOLD',
    category: 'Engine',
    medianWeightKg: 6,
    minWeightKg: 1.5,
    maxWeightKg: 18,
    typicalDimsCm: { l: 52, w: 38, h: 28 },
    volumetricDominant: true,
    keywords: ['intake manifold', 'inlet manifold', 'ansaugkr'],
  },
  {
    key: 'TIMING_KIT',
    category: 'Engine',
    medianWeightKg: 2.4,
    minWeightKg: 0.3,
    maxWeightKg: 9,
    typicalDimsCm: { l: 34, w: 30, h: 10 },
    volumetricDominant: false,
    keywords: ['timing belt', 'timing chain', 'timing kit', 'cambelt', 'zahnriemen'],
  },
  {
    key: 'OIL_PAN',
    category: 'Engine',
    medianWeightKg: 4,
    minWeightKg: 1,
    maxWeightKg: 14,
    typicalDimsCm: { l: 55, w: 35, h: 20 },
    volumetricDominant: true,
    keywords: ['oil pan', 'oil sump', 'sump pan', 'ölwanne'],
  },
  {
    key: 'ENGINE_MOUNT',
    category: 'Engine',
    medianWeightKg: 1.6,
    minWeightKg: 0.2,
    maxWeightKg: 6,
    typicalDimsCm: { l: 22, w: 18, h: 14 },
    volumetricDominant: false,
    keywords: ['engine mount', 'engine mounting', 'motorlager', 'gearbox mount'],
  },
  {
    key: 'GASKET_SET',
    category: 'Engine',
    medianWeightKg: 0.5,
    minWeightKg: 0.02,
    maxWeightKg: 4,
    typicalDimsCm: { l: 32, w: 26, h: 5 },
    volumetricDominant: true,
    keywords: ['gasket', 'gasket set', 'head gasket', 'seal ring', 'dichtung', 'oil seal'],
  },
  {
    key: 'OIL_FILTER',
    category: 'Engine',
    medianWeightKg: 0.45,
    minWeightKg: 0.05,
    maxWeightKg: 2,
    typicalDimsCm: { l: 14, w: 12, h: 12 },
    volumetricDominant: false,
    keywords: ['oil filter', 'ölfilter'],
  },
  {
    key: 'AIR_FILTER',
    category: 'Engine',
    medianWeightKg: 0.6,
    minWeightKg: 0.08,
    maxWeightKg: 3,
    typicalDimsCm: { l: 34, w: 26, h: 10 },
    volumetricDominant: true,
    keywords: ['air filter', 'cabin filter', 'pollen filter', 'luftfilter', 'fuel filter'],
  },
  {
    key: 'SPARK_PLUG',
    category: 'Engine',
    medianWeightKg: 0.25,
    minWeightKg: 0.02,
    maxWeightKg: 1.5,
    typicalDimsCm: { l: 16, w: 10, h: 6 },
    volumetricDominant: false,
    keywords: ['spark plug', 'glow plug', 'zündkerze'],
  },
  {
    key: 'FUEL_INJECTOR',
    category: 'Engine',
    medianWeightKg: 0.4,
    minWeightKg: 0.05,
    maxWeightKg: 2.5,
    typicalDimsCm: { l: 18, w: 12, h: 8 },
    volumetricDominant: false,
    keywords: ['fuel injector', 'injector nozzle', 'injektor', 'einspritzd'],
  },
  {
    key: 'FUEL_PUMP',
    category: 'Engine',
    medianWeightKg: 1.8,
    minWeightKg: 0.3,
    maxWeightKg: 7,
    typicalDimsCm: { l: 28, w: 18, h: 16 },
    volumetricDominant: false,
    keywords: ['fuel pump', 'kraftstoffpumpe', 'high pressure pump'],
  },
  {
    key: 'OIL_PUMP',
    category: 'Engine',
    medianWeightKg: 2.6,
    minWeightKg: 0.5,
    maxWeightKg: 9,
    typicalDimsCm: { l: 26, w: 20, h: 16 },
    volumetricDominant: false,
    keywords: ['oil pump', 'vacuum pump', 'ölpumpe'],
  },
  {
    key: 'THROTTLE_BODY',
    category: 'Engine',
    medianWeightKg: 1.4,
    minWeightKg: 0.3,
    maxWeightKg: 5,
    typicalDimsCm: { l: 22, w: 18, h: 16 },
    volumetricDominant: false,
    keywords: ['throttle body', 'throttle valve', 'egr valve', 'drosselklappe'],
  },

  // ── Transmission / Drivetrain ─────────────────────────────────────────────
  {
    key: 'TRANSMISSION_ASSEMBLY',
    category: 'Transmission',
    medianWeightKg: 75,
    minWeightKg: 25,
    maxWeightKg: 220,
    typicalDimsCm: { l: 80, w: 60, h: 60 },
    volumetricDominant: false,
    keywords: ['transmission assembly', 'gearbox assembly', 'complete gearbox', 'automatic transmission', 'manual transmission', 'getriebe'],
  },
  {
    key: 'CLUTCH_KIT',
    category: 'Transmission',
    medianWeightKg: 9,
    minWeightKg: 2,
    maxWeightKg: 26,
    typicalDimsCm: { l: 42, w: 42, h: 20 },
    volumetricDominant: false,
    keywords: ['clutch kit', 'clutch disc', 'clutch plate', 'pressure plate', 'clutch', 'kupplung'],
  },
  {
    key: 'FLYWHEEL',
    category: 'Transmission',
    medianWeightKg: 9,
    minWeightKg: 3,
    maxWeightKg: 26,
    typicalDimsCm: { l: 40, w: 40, h: 14 },
    volumetricDominant: false,
    keywords: ['flywheel', 'dual mass', 'schwungrad'],
  },
  {
    key: 'TORQUE_CONVERTER',
    category: 'Transmission',
    medianWeightKg: 12,
    minWeightKg: 4,
    maxWeightKg: 32,
    typicalDimsCm: { l: 40, w: 40, h: 22 },
    volumetricDominant: false,
    keywords: ['torque converter', 'drehmomentwandler'],
  },
  {
    key: 'DIFFERENTIAL',
    category: 'Transmission',
    medianWeightKg: 35,
    minWeightKg: 10,
    maxWeightKg: 110,
    typicalDimsCm: { l: 60, w: 50, h: 45 },
    volumetricDominant: false,
    keywords: ['differential', 'diff assembly', 'transfer case', 'differentialgetriebe'],
  },
  {
    key: 'DRIVESHAFT',
    category: 'Transmission',
    medianWeightKg: 12,
    minWeightKg: 3,
    maxWeightKg: 40,
    typicalDimsCm: { l: 140, w: 20, h: 20 },
    volumetricDominant: false,
    keywords: ['driveshaft', 'drive shaft', 'propeller shaft', 'prop shaft', 'kardanwelle'],
  },
  {
    key: 'CV_JOINT_AXLE',
    category: 'Transmission',
    medianWeightKg: 6,
    minWeightKg: 1.5,
    maxWeightKg: 20,
    typicalDimsCm: { l: 70, w: 20, h: 20 },
    volumetricDominant: false,
    keywords: ['cv joint', 'cv axle', 'axle shaft', 'half shaft', 'antriebswelle', 'cv boot'],
  },

  // ── Suspension / Steering ─────────────────────────────────────────────────
  {
    key: 'SHOCK_ABSORBER_STRUT',
    category: 'Suspension',
    medianWeightKg: 4.5,
    minWeightKg: 1.2,
    maxWeightKg: 14,
    typicalDimsCm: { l: 70, w: 20, h: 20 },
    volumetricDominant: false,
    keywords: ['shock absorber', 'strut assembly', 'shock', 'strut', 'damper', 'stoßd'],
  },
  {
    key: 'COIL_SPRING',
    category: 'Suspension',
    medianWeightKg: 4,
    minWeightKg: 1,
    maxWeightKg: 14,
    typicalDimsCm: { l: 40, w: 24, h: 24 },
    volumetricDominant: false,
    keywords: ['coil spring', 'suspension spring', 'air spring', 'air suspension', 'feder'],
  },
  {
    key: 'LEAF_SPRING',
    category: 'Suspension',
    medianWeightKg: 22,
    minWeightKg: 6,
    maxWeightKg: 70,
    typicalDimsCm: { l: 130, w: 20, h: 14 },
    volumetricDominant: false,
    keywords: ['leaf spring', 'blattfeder'],
  },
  {
    key: 'CONTROL_ARM',
    category: 'Suspension',
    medianWeightKg: 4.5,
    minWeightKg: 1,
    maxWeightKg: 16,
    typicalDimsCm: { l: 56, w: 32, h: 16 },
    volumetricDominant: false,
    keywords: ['control arm', 'wishbone', 'trailing arm', 'suspension arm', 'querlenker', 'track arm'],
  },
  {
    key: 'BALL_JOINT',
    category: 'Suspension',
    medianWeightKg: 0.8,
    minWeightKg: 0.1,
    maxWeightKg: 4,
    typicalDimsCm: { l: 18, w: 14, h: 10 },
    volumetricDominant: false,
    keywords: ['ball joint', 'traggelenk'],
  },
  {
    key: 'TIE_ROD',
    category: 'Suspension',
    medianWeightKg: 1,
    minWeightKg: 0.15,
    maxWeightKg: 5,
    typicalDimsCm: { l: 42, w: 14, h: 10 },
    volumetricDominant: false,
    keywords: ['tie rod', 'track rod', 'steering rod', 'spurstange', 'drag link'],
  },
  {
    key: 'STABILIZER_LINK',
    category: 'Suspension',
    medianWeightKg: 0.5,
    minWeightKg: 0.05,
    maxWeightKg: 3,
    typicalDimsCm: { l: 32, w: 12, h: 8 },
    volumetricDominant: false,
    keywords: ['stabilizer link', 'sway bar link', 'anti roll bar', 'stabilizer bar', 'koppelstange', 'sway bar'],
  },
  {
    key: 'BUSHING',
    category: 'Suspension',
    medianWeightKg: 0.25,
    minWeightKg: 0.01,
    maxWeightKg: 2,
    typicalDimsCm: { l: 14, w: 12, h: 8 },
    volumetricDominant: false,
    keywords: ['bushing', 'bush kit', 'buchse', 'mounting bush'],
  },
  {
    key: 'WHEEL_BEARING_HUB',
    category: 'Suspension',
    medianWeightKg: 3.2,
    minWeightKg: 0.4,
    maxWeightKg: 12,
    typicalDimsCm: { l: 24, w: 22, h: 16 },
    volumetricDominant: false,
    keywords: ['wheel bearing', 'hub bearing', 'wheel hub', 'hub assembly', 'radlager'],
  },
  {
    key: 'STEERING_RACK',
    category: 'Suspension',
    medianWeightKg: 11,
    minWeightKg: 3,
    maxWeightKg: 32,
    typicalDimsCm: { l: 100, w: 26, h: 22 },
    volumetricDominant: false,
    keywords: ['steering rack', 'steering gear', 'rack and pinion', 'lenkgetriebe'],
  },
  {
    key: 'POWER_STEERING_PUMP',
    category: 'Suspension',
    medianWeightKg: 4,
    minWeightKg: 1,
    maxWeightKg: 12,
    typicalDimsCm: { l: 28, w: 22, h: 20 },
    volumetricDominant: false,
    keywords: ['power steering pump', 'steering pump', 'servopumpe'],
  },

  // ── Electrical ────────────────────────────────────────────────────────────
  {
    key: 'ALTERNATOR',
    category: 'Electrical',
    medianWeightKg: 5.8,
    minWeightKg: 2,
    maxWeightKg: 16,
    typicalDimsCm: { l: 32, w: 26, h: 24 },
    volumetricDominant: false,
    keywords: ['alternator', 'generator', 'lichtmaschine'],
  },
  {
    key: 'STARTER_MOTOR',
    category: 'Electrical',
    medianWeightKg: 4.5,
    minWeightKg: 1.5,
    maxWeightKg: 14,
    typicalDimsCm: { l: 32, w: 20, h: 20 },
    volumetricDominant: false,
    keywords: ['starter motor', 'starter', 'anlasser'],
  },
  {
    key: 'BATTERY',
    category: 'Electrical',
    medianWeightKg: 17,
    minWeightKg: 3,
    maxWeightKg: 45,
    typicalDimsCm: { l: 32, w: 22, h: 24 },
    volumetricDominant: false,
    keywords: ['battery', 'batterie', 'accumulator'],
  },
  {
    key: 'ECU_MODULE',
    category: 'Electrical',
    medianWeightKg: 0.9,
    minWeightKg: 0.1,
    maxWeightKg: 5,
    typicalDimsCm: { l: 26, w: 20, h: 10 },
    volumetricDominant: true,
    keywords: ['ecu', 'engine control unit', 'control module', 'control unit', 'bcm', 'steuerger'],
  },
  {
    key: 'SENSOR',
    category: 'Electrical',
    medianWeightKg: 0.18,
    minWeightKg: 0.01,
    maxWeightKg: 1.5,
    typicalDimsCm: { l: 16, w: 12, h: 8 },
    volumetricDominant: true,
    keywords: ['sensor', 'sender unit', 'geber', 'switch', 'schalter'],
  },
  {
    key: 'IGNITION_COIL',
    category: 'Electrical',
    medianWeightKg: 0.5,
    minWeightKg: 0.05,
    maxWeightKg: 3,
    typicalDimsCm: { l: 20, w: 14, h: 10 },
    volumetricDominant: false,
    keywords: ['ignition coil', 'coil pack', 'zündspule', 'distributor'],
  },
  {
    key: 'WIRING_HARNESS',
    category: 'Electrical',
    medianWeightKg: 3.5,
    minWeightKg: 0.2,
    maxWeightKg: 18,
    typicalDimsCm: { l: 50, w: 42, h: 26 },
    volumetricDominant: true,
    keywords: ['wiring harness', 'wire harness', 'wiring loom', 'kabelbaum', 'wiring'],
  },
  {
    key: 'HEADLIGHT_ASSEMBLY',
    category: 'Electrical',
    medianWeightKg: 4.2,
    minWeightKg: 0.8,
    maxWeightKg: 14,
    typicalDimsCm: { l: 72, w: 46, h: 36 },
    volumetricDominant: true,
    keywords: ['headlight', 'head lamp', 'headlamp', 'fog light', 'scheinwerfer', 'xenon', 'led headlight'],
  },
  {
    key: 'TAIL_LIGHT',
    category: 'Electrical',
    medianWeightKg: 2.2,
    minWeightKg: 0.3,
    maxWeightKg: 8,
    typicalDimsCm: { l: 56, w: 42, h: 26 },
    volumetricDominant: true,
    keywords: ['tail light', 'tail lamp', 'rear light', 'rear lamp', 'brake light', 'rückleuchte'],
  },
  {
    key: 'FUSE_BOX',
    category: 'Electrical',
    medianWeightKg: 1.1,
    minWeightKg: 0.1,
    maxWeightKg: 5,
    typicalDimsCm: { l: 28, w: 22, h: 14 },
    volumetricDominant: true,
    keywords: ['fuse box', 'relay box', 'sicherungskasten', 'junction box'],
  },
  {
    key: 'SMALL_MOTOR_ACTUATOR',
    category: 'Electrical',
    medianWeightKg: 1.8,
    minWeightKg: 0.2,
    maxWeightKg: 7,
    typicalDimsCm: { l: 26, w: 20, h: 14 },
    volumetricDominant: false,
    keywords: ['window motor', 'window regulator', 'wiper motor', 'blower motor', 'actuator', 'door lock', 'fensterheber'],
  },

  // ── Body ──────────────────────────────────────────────────────────────────
  {
    key: 'BUMPER_COVER',
    category: 'Body',
    medianWeightKg: 8,
    minWeightKg: 2,
    maxWeightKg: 30,
    typicalDimsCm: { l: 165, w: 55, h: 38 },
    volumetricDominant: true,
    keywords: ['bumper', 'bumper cover', 'bumper bar', 'stoßstange', 'parachoques'],
  },
  {
    key: 'FENDER',
    category: 'Body',
    medianWeightKg: 7,
    minWeightKg: 2,
    maxWeightKg: 24,
    typicalDimsCm: { l: 120, w: 72, h: 26 },
    volumetricDominant: true,
    keywords: ['fender', 'wing panel', 'quarter panel', 'kotfl'],
  },
  {
    key: 'HOOD_BONNET',
    category: 'Body',
    medianWeightKg: 16,
    minWeightKg: 5,
    maxWeightKg: 45,
    typicalDimsCm: { l: 150, w: 122, h: 22 },
    volumetricDominant: true,
    keywords: ['hood', 'bonnet', 'motorhaube'],
  },
  {
    key: 'DOOR_SHELL',
    category: 'Body',
    medianWeightKg: 28,
    minWeightKg: 8,
    maxWeightKg: 70,
    typicalDimsCm: { l: 132, w: 102, h: 26 },
    volumetricDominant: true,
    keywords: ['door shell', 'door assembly', 'car door', 'front door', 'rear door', 'tür'],
  },
  {
    key: 'TRUNK_TAILGATE',
    category: 'Body',
    medianWeightKg: 20,
    minWeightKg: 6,
    maxWeightKg: 55,
    typicalDimsCm: { l: 132, w: 112, h: 26 },
    volumetricDominant: true,
    keywords: ['tailgate', 'trunk lid', 'boot lid', 'liftgate', 'heckklappe'],
  },
  {
    key: 'DOOR_MIRROR',
    category: 'Body',
    medianWeightKg: 1.6,
    minWeightKg: 0.3,
    maxWeightKg: 6,
    typicalDimsCm: { l: 32, w: 26, h: 22 },
    volumetricDominant: true,
    keywords: ['mirror', 'side mirror', 'wing mirror', 'door mirror', 'spiegel'],
  },
  {
    key: 'GRILLE',
    category: 'Body',
    medianWeightKg: 3.5,
    minWeightKg: 0.5,
    maxWeightKg: 14,
    typicalDimsCm: { l: 112, w: 42, h: 22 },
    volumetricDominant: true,
    keywords: ['grille', 'grill', 'radiator grille', 'kühlergrill'],
  },
  {
    key: 'GLASS_WINDSHIELD',
    category: 'Body',
    medianWeightKg: 16,
    minWeightKg: 3,
    maxWeightKg: 45,
    typicalDimsCm: { l: 150, w: 92, h: 12 },
    volumetricDominant: true,
    keywords: ['windshield', 'windscreen', 'window glass', 'door glass', 'rear glass', 'windschutzscheibe'],
  },
  {
    key: 'BODY_TRIM_MOULDING',
    category: 'Body',
    medianWeightKg: 2.5,
    minWeightKg: 0.1,
    maxWeightKg: 10,
    typicalDimsCm: { l: 100, w: 30, h: 16 },
    volumetricDominant: true,
    keywords: ['moulding', 'molding', 'wheel arch', 'trim panel', 'spoiler', 'splash guard', 'mud flap', 'sill cover'],
  },
  {
    key: 'BODY_PANEL_GENERIC',
    category: 'Body',
    medianWeightKg: 11,
    minWeightKg: 1,
    maxWeightKg: 60,
    typicalDimsCm: { l: 110, w: 80, h: 28 },
    volumetricDominant: true,
    keywords: ['body panel', 'radiator support', 'apron panel'],
  },

  // ── Interior ──────────────────────────────────────────────────────────────
  {
    key: 'SEAT_ASSEMBLY',
    category: 'Interior',
    medianWeightKg: 25,
    minWeightKg: 6,
    maxWeightKg: 70,
    typicalDimsCm: { l: 82, w: 72, h: 92 },
    volumetricDominant: true,
    keywords: ['seat assembly', 'car seat', 'front seat', 'rear seat', 'seat frame', 'sitz'],
  },
  {
    key: 'DASHBOARD',
    category: 'Interior',
    medianWeightKg: 15,
    minWeightKg: 3,
    maxWeightKg: 45,
    typicalDimsCm: { l: 150, w: 62, h: 52 },
    volumetricDominant: true,
    keywords: ['dashboard', 'dash panel', 'instrument panel', 'armaturenbrett'],
  },
  {
    key: 'STEERING_WHEEL',
    category: 'Interior',
    medianWeightKg: 3,
    minWeightKg: 0.6,
    maxWeightKg: 10,
    typicalDimsCm: { l: 46, w: 46, h: 20 },
    volumetricDominant: true,
    keywords: ['steering wheel', 'lenkrad', 'steering column'],
  },
  {
    key: 'AIRBAG',
    category: 'Interior',
    medianWeightKg: 2.5,
    minWeightKg: 0.4,
    maxWeightKg: 9,
    typicalDimsCm: { l: 34, w: 28, h: 20 },
    volumetricDominant: true,
    keywords: ['airbag', 'air bag', 'seat belt', 'seatbelt', 'sicherheitsgurt'],
  },
  {
    key: 'INTERIOR_TRIM',
    category: 'Interior',
    medianWeightKg: 4.5,
    minWeightKg: 0.2,
    maxWeightKg: 18,
    typicalDimsCm: { l: 80, w: 50, h: 30 },
    volumetricDominant: true,
    keywords: ['center console', 'centre console', 'glove box', 'door card', 'door trim', 'headliner', 'carpet', 'sun visor'],
  },
  {
    key: 'INSTRUMENT_CLUSTER',
    category: 'Interior',
    medianWeightKg: 1.6,
    minWeightKg: 0.2,
    maxWeightKg: 6,
    typicalDimsCm: { l: 34, w: 24, h: 16 },
    volumetricDominant: true,
    keywords: ['instrument cluster', 'speedometer', 'tachometer', 'radio unit', 'head unit', 'infotainment', 'kombiinstrument'],
  },

  // ── Wheels ────────────────────────────────────────────────────────────────
  {
    key: 'ALLOY_WHEEL',
    category: 'Wheels',
    medianWeightKg: 12,
    minWeightKg: 5,
    maxWeightKg: 30,
    typicalDimsCm: { l: 52, w: 52, h: 26 },
    volumetricDominant: false,
    keywords: ['alloy wheel', 'alloy rim', 'wheel rim', 'rim', 'felge', 'steel wheel'],
  },
  {
    key: 'TIRE',
    category: 'Wheels',
    medianWeightKg: 11,
    minWeightKg: 4,
    maxWeightKg: 32,
    typicalDimsCm: { l: 66, w: 66, h: 26 },
    volumetricDominant: true,
    keywords: ['tire', 'tyre', 'reifen'],
  },
  {
    key: 'HUBCAP_TRIM',
    category: 'Wheels',
    medianWeightKg: 1,
    minWeightKg: 0.1,
    maxWeightKg: 4,
    typicalDimsCm: { l: 42, w: 42, h: 14 },
    volumetricDominant: true,
    keywords: ['hubcap', 'hub cap', 'wheel cover', 'wheel trim', 'center cap', 'radkappe'],
  },
  {
    key: 'TPMS_SENSOR',
    category: 'Wheels',
    medianWeightKg: 0.08,
    minWeightKg: 0.01,
    maxWeightKg: 0.6,
    typicalDimsCm: { l: 12, w: 8, h: 6 },
    volumetricDominant: true,
    keywords: ['tpms', 'tyre pressure sensor', 'tire pressure sensor'],
  },

  // ── Cooling / HVAC ────────────────────────────────────────────────────────
  {
    key: 'RADIATOR',
    category: 'Cooling',
    medianWeightKg: 7,
    minWeightKg: 2,
    maxWeightKg: 24,
    typicalDimsCm: { l: 78, w: 52, h: 14 },
    volumetricDominant: true,
    keywords: ['radiator', 'kühler'],
  },
  {
    key: 'CONDENSER_AC',
    category: 'Cooling',
    medianWeightKg: 5,
    minWeightKg: 1.5,
    maxWeightKg: 16,
    typicalDimsCm: { l: 72, w: 48, h: 12 },
    volumetricDominant: true,
    keywords: ['condenser', 'ac condenser', 'kondensator'],
  },
  {
    key: 'INTERCOOLER',
    category: 'Cooling',
    medianWeightKg: 6.5,
    minWeightKg: 2,
    maxWeightKg: 20,
    typicalDimsCm: { l: 68, w: 38, h: 14 },
    volumetricDominant: true,
    keywords: ['intercooler', 'charge air cooler', 'oil cooler', 'ladeluftk'],
  },
  {
    key: 'COOLING_FAN_ASSEMBLY',
    category: 'Cooling',
    medianWeightKg: 4,
    minWeightKg: 0.8,
    maxWeightKg: 14,
    typicalDimsCm: { l: 62, w: 58, h: 20 },
    volumetricDominant: true,
    keywords: ['cooling fan', 'radiator fan', 'fan assembly', 'fan shroud', 'fan clutch', 'lüfter'],
  },
  {
    key: 'WATER_PUMP',
    category: 'Cooling',
    medianWeightKg: 2.2,
    minWeightKg: 0.4,
    maxWeightKg: 8,
    typicalDimsCm: { l: 24, w: 20, h: 16 },
    volumetricDominant: false,
    keywords: ['water pump', 'coolant pump', 'wasserpumpe'],
  },
  {
    key: 'THERMOSTAT',
    category: 'Cooling',
    medianWeightKg: 0.35,
    minWeightKg: 0.03,
    maxWeightKg: 2,
    typicalDimsCm: { l: 16, w: 12, h: 10 },
    volumetricDominant: false,
    keywords: ['thermostat', 'coolant flange', 'thermostatgeh'],
  },
  {
    key: 'EXPANSION_TANK',
    category: 'Cooling',
    medianWeightKg: 0.9,
    minWeightKg: 0.1,
    maxWeightKg: 4,
    typicalDimsCm: { l: 36, w: 26, h: 24 },
    volumetricDominant: true,
    keywords: ['expansion tank', 'coolant reservoir', 'header tank', 'ausgleichsbeh'],
  },
  {
    key: 'AC_COMPRESSOR',
    category: 'Cooling',
    medianWeightKg: 6.5,
    minWeightKg: 2,
    maxWeightKg: 18,
    typicalDimsCm: { l: 32, w: 26, h: 26 },
    volumetricDominant: false,
    keywords: ['ac compressor', 'a/c compressor', 'air conditioning compressor', 'klimakompressor'],
  },
  {
    key: 'HEATER_CORE',
    category: 'Cooling',
    medianWeightKg: 2.2,
    minWeightKg: 0.4,
    maxWeightKg: 9,
    typicalDimsCm: { l: 42, w: 30, h: 14 },
    volumetricDominant: true,
    keywords: ['heater core', 'heater matrix', 'evaporator', 'heizungsk'],
  },

  // ── Exhaust ───────────────────────────────────────────────────────────────
  {
    key: 'CATALYTIC_CONVERTER',
    category: 'Exhaust',
    medianWeightKg: 8,
    minWeightKg: 2,
    maxWeightKg: 26,
    typicalDimsCm: { l: 62, w: 32, h: 26 },
    volumetricDominant: false,
    keywords: ['catalytic converter', 'catalyst', 'katalysator'],
  },
  {
    key: 'DPF_FILTER',
    category: 'Exhaust',
    medianWeightKg: 14,
    minWeightKg: 4,
    maxWeightKg: 40,
    typicalDimsCm: { l: 62, w: 38, h: 34 },
    volumetricDominant: false,
    keywords: ['dpf', 'particulate filter', 'diesel particulate', 'partikelfilter'],
  },
  {
    key: 'MUFFLER',
    category: 'Exhaust',
    medianWeightKg: 7.5,
    minWeightKg: 2,
    maxWeightKg: 24,
    typicalDimsCm: { l: 82, w: 42, h: 32 },
    volumetricDominant: true,
    keywords: ['muffler', 'silencer', 'back box', 'schalld'],
  },
  {
    key: 'EXHAUST_MANIFOLD',
    category: 'Exhaust',
    medianWeightKg: 7.5,
    minWeightKg: 2,
    maxWeightKg: 22,
    typicalDimsCm: { l: 52, w: 34, h: 26 },
    volumetricDominant: false,
    keywords: ['exhaust manifold', 'header pipe', 'downpipe', 'abgaskr'],
  },
  {
    key: 'EXHAUST_PIPE',
    category: 'Exhaust',
    medianWeightKg: 5,
    minWeightKg: 1,
    maxWeightKg: 18,
    typicalDimsCm: { l: 122, w: 22, h: 22 },
    volumetricDominant: true,
    keywords: ['exhaust pipe', 'exhaust system', 'flex pipe', 'auspuff'],
  },
  {
    key: 'OXYGEN_SENSOR',
    category: 'Exhaust',
    medianWeightKg: 0.25,
    minWeightKg: 0.02,
    maxWeightKg: 1.2,
    typicalDimsCm: { l: 18, w: 12, h: 8 },
    volumetricDominant: true,
    keywords: ['oxygen sensor', 'lambda sensor', 'o2 sensor', 'lambdasonde'],
  },

  // ── General consumables ───────────────────────────────────────────────────
  {
    key: 'BELT_HOSE',
    category: 'General',
    medianWeightKg: 0.7,
    minWeightKg: 0.05,
    maxWeightKg: 5,
    typicalDimsCm: { l: 34, w: 30, h: 12 },
    volumetricDominant: true,
    keywords: ['drive belt', 'serpentine belt', 'v-belt', 'radiator hose', 'coolant hose', 'vacuum hose', 'keilrippenriemen', 'hose'],
  },
  {
    key: 'WIPER_BLADE',
    category: 'General',
    medianWeightKg: 0.35,
    minWeightKg: 0.05,
    maxWeightKg: 2,
    typicalDimsCm: { l: 72, w: 10, h: 6 },
    volumetricDominant: true,
    keywords: ['wiper blade', 'windshield wiper', 'wischblatt'],
  },
  {
    key: 'HARDWARE_FASTENER',
    category: 'General',
    medianWeightKg: 0.15,
    minWeightKg: 0.005,
    maxWeightKg: 2,
    typicalDimsCm: { l: 14, w: 10, h: 6 },
    volumetricDominant: true,
    keywords: ['bolt', 'screw', 'nut set', 'clip set', 'retainer', 'washer', 'fastener', 'schraube'],
  },
];

/** Coarse fallbacks used when no title keyword matches but a category is known. */
const CATEGORY_FALLBACKS: Record<string, PartClassProfile> = {
  Engine: {
    key: 'ENGINE_COMPONENT_GENERIC',
    category: 'Engine',
    medianWeightKg: 6,
    minWeightKg: 0.05,
    maxWeightKg: 450,
    typicalDimsCm: { l: 40, w: 30, h: 24 },
    volumetricDominant: false,
    keywords: [],
  },
  Transmission: {
    key: 'TRANSMISSION_COMPONENT_GENERIC',
    category: 'Transmission',
    medianWeightKg: 10,
    minWeightKg: 0.05,
    maxWeightKg: 220,
    typicalDimsCm: { l: 46, w: 36, h: 30 },
    volumetricDominant: false,
    keywords: [],
  },
  Brakes: {
    key: 'BRAKE_COMPONENT_GENERIC',
    category: 'Brakes',
    medianWeightKg: 3.5,
    minWeightKg: 0.05,
    maxWeightKg: 30,
    typicalDimsCm: { l: 30, w: 24, h: 14 },
    volumetricDominant: false,
    keywords: [],
  },
  Suspension: {
    key: 'SUSPENSION_COMPONENT_GENERIC',
    category: 'Suspension',
    medianWeightKg: 3.5,
    minWeightKg: 0.05,
    maxWeightKg: 70,
    typicalDimsCm: { l: 46, w: 26, h: 18 },
    volumetricDominant: false,
    keywords: [],
  },
  Electrical: {
    key: 'ELECTRICAL_COMPONENT_GENERIC',
    category: 'Electrical',
    medianWeightKg: 1.5,
    minWeightKg: 0.01,
    maxWeightKg: 45,
    typicalDimsCm: { l: 28, w: 22, h: 16 },
    volumetricDominant: true,
    keywords: [],
  },
  Body: {
    key: 'BODY_COMPONENT_GENERIC',
    category: 'Body',
    medianWeightKg: 9,
    minWeightKg: 0.1,
    maxWeightKg: 70,
    typicalDimsCm: { l: 110, w: 70, h: 28 },
    volumetricDominant: true,
    keywords: [],
  },
  Interior: {
    key: 'INTERIOR_COMPONENT_GENERIC',
    category: 'Interior',
    medianWeightKg: 5,
    minWeightKg: 0.05,
    maxWeightKg: 70,
    typicalDimsCm: { l: 70, w: 46, h: 30 },
    volumetricDominant: true,
    keywords: [],
  },
  Wheels: {
    key: 'WHEEL_COMPONENT_GENERIC',
    category: 'Wheels',
    medianWeightKg: 10,
    minWeightKg: 0.05,
    maxWeightKg: 32,
    typicalDimsCm: { l: 52, w: 52, h: 24 },
    volumetricDominant: true,
    keywords: [],
  },
  Cooling: {
    key: 'COOLING_COMPONENT_GENERIC',
    category: 'Cooling',
    medianWeightKg: 4,
    minWeightKg: 0.05,
    maxWeightKg: 24,
    typicalDimsCm: { l: 56, w: 40, h: 18 },
    volumetricDominant: true,
    keywords: [],
  },
  Exhaust: {
    key: 'EXHAUST_COMPONENT_GENERIC',
    category: 'Exhaust',
    medianWeightKg: 7,
    minWeightKg: 0.05,
    maxWeightKg: 40,
    typicalDimsCm: { l: 66, w: 34, h: 26 },
    volumetricDominant: true,
    keywords: [],
  },
};

/**
 * Global fallback. Deliberately well above the legacy 1kg default: under-quoting
 * costs the marketplace real money on every parcel, while a modest over-estimate
 * is corrected as soon as the part is enriched.
 */
export const DEFAULT_PART_CLASS: PartClassProfile = {
  key: 'PART_GENERIC',
  category: 'General',
  medianWeightKg: 4,
  minWeightKg: 0.01,
  maxWeightKg: 450,
  typicalDimsCm: { l: 36, w: 28, h: 20 },
  volumetricDominant: false,
  keywords: [],
};

const PROFILES_BY_KEY = new Map<string, PartClassProfile>([
  ...PROFILES.map((p) => [p.key, p] as const),
  ...Object.values(CATEGORY_FALLBACKS).map((p) => [p.key, p] as const),
  [DEFAULT_PART_CLASS.key, DEFAULT_PART_CLASS],
]);

/**
 * Keyword index compiled once. Matching prefers the longest keyword across all
 * classes so specific phrases ("brake pad") beat the generic ones ("brake")
 * regardless of declaration order.
 */
const KEYWORD_INDEX: Array<{
  pattern: RegExp;
  length: number;
  profile: PartClassProfile;
}> = PROFILES.flatMap((profile) =>
  profile.keywords.map((keyword) => ({
    // Keywords are prefixes in places (e.g. 'kotfl' for umlaut variants), so
    // only the leading edge is anchored to a word boundary.
    pattern: new RegExp(`\\b${escapeRegExp(keyword)}`, 'i'),
    length: keyword.length,
    profile,
  })),
).sort((a, b) => b.length - a.length);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getPartClassProfile(
  key: string | null | undefined,
): PartClassProfile {
  if (!key) return DEFAULT_PART_CLASS;
  return PROFILES_BY_KEY.get(key) ?? DEFAULT_PART_CLASS;
}

export interface ResolvePartClassInput {
  title?: string | null;
  category?: string | null;
}

const RESOLUTION_CACHE = new Map<string, string>();
const RESOLUTION_CACHE_LIMIT = 5000;

/**
 * Resolves a part-class key from the title (preferred) then the coarse category.
 * Returns `PART_GENERIC` when nothing matches.
 */
export function resolvePartClassKey({
  title,
  category,
}: ResolvePartClassInput): string {
  const normalizedTitle = (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedCategory = (category || '').trim();
  const cacheKey = `${normalizedCategory}\u0000${normalizedTitle}`;

  const cached = RESOLUTION_CACHE.get(cacheKey);
  if (cached) return cached;

  let resolved = DEFAULT_PART_CLASS.key;

  if (normalizedTitle) {
    // KEYWORD_INDEX is sorted longest-first, so the first hit is the most specific.
    const hit = KEYWORD_INDEX.find((entry) => entry.pattern.test(normalizedTitle));
    if (hit) resolved = hit.profile.key;
  }

  if (resolved === DEFAULT_PART_CLASS.key && normalizedCategory) {
    const fallback = CATEGORY_FALLBACKS[normalizedCategory];
    if (fallback) resolved = fallback.key;
  }

  if (RESOLUTION_CACHE.size >= RESOLUTION_CACHE_LIMIT) RESOLUTION_CACHE.clear();
  RESOLUTION_CACHE.set(cacheKey, resolved);
  return resolved;
}

export function resolvePartClass(
  input: ResolvePartClassInput,
): PartClassProfile {
  return getPartClassProfile(resolvePartClassKey(input));
}

/** Clamps an estimated weight into the class envelope. */
export function clampWeightToClass(
  weightKg: number,
  profile: PartClassProfile,
): { kg: number; clamped: boolean } {
  if (weightKg < profile.minWeightKg) {
    return { kg: profile.minWeightKg, clamped: true };
  }
  if (weightKg > profile.maxWeightKg) {
    return { kg: profile.maxWeightKg, clamped: true };
  }
  return { kg: weightKg, clamped: false };
}

export const ALL_PART_CLASS_PROFILES: readonly PartClassProfile[] = [
  ...PROFILES,
  ...Object.values(CATEGORY_FALLBACKS),
  DEFAULT_PART_CLASS,
];
