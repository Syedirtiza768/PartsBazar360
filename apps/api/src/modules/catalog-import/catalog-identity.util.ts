import {
  MAKE_ALIASES,
  MODELS_BY_MAKE,
} from '../search/query/automotive-vocabulary';

/**
 * Canonical buyer-facing identities for brands and vehicle makes.
 *
 * The database master tables are intentionally not used as the only source:
 * production currently contains case-duplicates, model names stored as makes,
 * and raw spreadsheet values stored as BrandMaster rows. This curated layer is
 * deterministic and can therefore normalize imports, index documents, facets,
 * and filter values in exactly the same way.
 */

type AliasMap = Readonly<Record<string, readonly string[]>>;

const EXTRA_MAKE_ALIASES: AliasMap = {
  Bentley: ['bently'],
  BYD: ['byd'],
  Cadillac: ['cadilac', 'cadlillac'],
  Chery: ['chery'],
  Chevrolet: ['chevorlet', 'chervolet', 'cherlovet', 'cheorlet'],
  Geely: ['geely'],
  Holden: ['holden'],
  Infiniti: ['infity', 'infitity'],
  Jaguar: ['jagaur', 'jaguars'],
  Jetour: ['jetour'],
  'Mercedes-Benz': ['mercede'],
  OMODA: ['omoda'],
  Peugeot: ['peguot', 'pegout'],
  Porsche: ['porcshe', 'poesche'],
  Toyota: ['toyata'],
  Volkswagen: ['volkwagen', 'v.w'],
  Zinoro: ['zinoro'],
};

const MODEL_ONLY_MAKES: Readonly<Record<string, string>> = {
  ACCENT: 'Hyundai',
  DMAX: 'Isuzu',
  PARTNER: 'Peugeot',
  SILVERADO: 'Chevrolet',
  TROOPER: 'Isuzu',
};

const PRODUCT_BRAND_ALIASES: AliasMap = {
  BOSCH: ['bosh', 'bosh-0242240566', 'bosh-0242240628', 'bosh-0242245581'],
  FEBI: ['febi bilstein'],
  'General Motors': ['general motors', 'gm'],
  'MANN-FILTER': ['mann', 'mann filter', 'mann-filter'],
  MEYLE: ['meyle'],
  REMSA: ['remsa'],
  SCHNIEDER: ['scheinder'],
  TOPDRIVE: ['top drive'],
  TRUCKTEC: ['truck tec'],
  'Volkswagen Group': ['vag'],
};

const NON_BRANDS = new Set([
  'GENUINEOEM',
  'OE',
  'OEM',
  'ORIGINAL',
  'SHEET1',
  'MODULE',
  'TRUNK',
  'UNKNOWN',
]);

export function catalogIdentityKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '');
}

function cleaned(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function addAliases(
  lookup: Map<string, string>,
  reverse: Map<string, Set<string>>,
  aliases: AliasMap,
) {
  for (const [canonical, values] of Object.entries(aliases)) {
    const terms = reverse.get(canonical) ?? new Set<string>();
    for (const value of [canonical, ...values]) {
      const key = catalogIdentityKey(value);
      if (key) lookup.set(key, canonical);
      terms.add(value);
      terms.add(value.toUpperCase());
      terms.add(value.toLowerCase());
      terms.add(
        value.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_match, separator, letter) =>
          `${separator}${letter.toUpperCase()}`,
        ),
      );
    }
    reverse.set(canonical, terms);
  }
}

const makeLookup = new Map<string, string>();
const makeTerms = new Map<string, Set<string>>();
addAliases(makeLookup, makeTerms, MAKE_ALIASES);
addAliases(makeLookup, makeTerms, EXTRA_MAKE_ALIASES);

// Known make + model strings found in legacy brand data. These normalize to
// the make while the model remains represented by its own field.
for (const [make, models] of Object.entries(MODELS_BY_MAKE)) {
  const terms = makeTerms.get(make) ?? new Set<string>();
  for (const model of models) {
    for (const value of [`${make} ${model}`, `${make}  ${model}`]) {
      makeLookup.set(catalogIdentityKey(value), make);
      terms.add(value);
      terms.add(value.toUpperCase());
    }
  }
  makeTerms.set(make, terms);
}

const productBrandLookup = new Map<string, string>();
const productBrandTerms = new Map<string, Set<string>>();
addAliases(productBrandLookup, productBrandTerms, PRODUCT_BRAND_ALIASES);

export function canonicalizeVehicleMake(value: unknown): string | null {
  return canonicalizeVehicleMakes(value)[0] ?? null;
}

function canonicalizeSingleVehicleMake(value: unknown): string | null {
  const name = cleaned(value);
  const key = catalogIdentityKey(name);
  if (!key || key === '-') return null;
  if (MODEL_ONLY_MAKES[key]) return MODEL_ONLY_MAKES[key];
  return makeLookup.get(key) ?? name;
}

export function canonicalizeVehicleMakes(value: unknown): string[] {
  const name = cleaned(value);
  if (!name) return [];

  const pieces = name
    .split(/\s*(?:\/|\\|\+|,|&|\band\b)\s*/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length > 1) {
    const makes = pieces
      .map(canonicalizeSingleVehicleMake)
      .filter((make): make is string => Boolean(make));
    if (makes.length === pieces.length) return unique(makes);
  }

  const single = canonicalizeSingleVehicleMake(name);
  return single ? [single] : [];
}

function maybeBrandCodePrefix(name: string): string | null {
  const match = name.match(
    /^([A-Za-z0-9][A-Za-z0-9 .&+/]*?[A-Za-z0-9])\s*[-_:]\s*(?=[A-Za-z0-9 ._/-]*\d)[A-Za-z0-9 ._/-]+$/,
  );
  if (!match) return null;

  const prefix = cleaned(match[1]);
  const key = catalogIdentityKey(prefix);
  const letterCount = (prefix.match(/[A-Za-z]/g) ?? []).length;
  if (letterCount < 2 || !key || NON_BRANDS.has(key)) return null;
  if (prefix.length > 40 || prefix.split(/\s+/).length > 4) return null;
  return prefix;
}

function canonicalizeCatalogBrandName(name: string, allowCodeStrip: boolean): string | null {
  const key = catalogIdentityKey(name);
  if (!key || NON_BRANDS.has(key)) return null;
  if (name.length > 80 || name.split(/\s+/).length > 9) return null;

  if (allowCodeStrip) {
    const prefix = maybeBrandCodePrefix(name);
    if (prefix) return canonicalizeCatalogBrandName(prefix, false);
  }

  const productBrand = productBrandLookup.get(key);
  if (productBrand) return productBrand;

  const make = makeLookup.get(key) ?? MODEL_ONLY_MAKES[key];
  if (make) return make;

  const combinedMakes = canonicalizeVehicleMakes(name);
  if (combinedMakes.length > 1) return combinedMakes[0];

  return name.toUpperCase();
}

export function canonicalizeCatalogBrand(value: unknown): string | null {
  const name = cleaned(value);
  if (!name) return null;
  return canonicalizeCatalogBrandName(name, true);
}

function expandFilterValues(
  values: string[],
  canonicalize: (value: unknown) => string | null,
  reverse: Map<string, Set<string>>,
): string[] {
  const expanded = new Set<string>();
  for (const raw of values) {
    const canonical = canonicalize(raw);
    if (!canonical) continue;
    const known = reverse.get(canonical);
    for (const value of known ?? [canonical]) {
      expanded.add(value);
      expanded.add(value.toUpperCase());
      expanded.add(value.toLowerCase());
    }
    expanded.add(canonical);
  }
  return [...expanded];
}

export function expandVehicleMakeFilterValues(values: string[]): string[] {
  return expandFilterValues(values, canonicalizeVehicleMake, makeTerms);
}

export function expandCatalogBrandFilterValues(values: string[]): string[] {
  const reverse = new Map(makeTerms);
  for (const [canonical, terms] of productBrandTerms) {
    const existing = reverse.get(canonical) ?? new Set<string>();
    for (const term of terms) existing.add(term);
    reverse.set(canonical, existing);
  }
  return expandFilterValues(values, canonicalizeCatalogBrand, reverse);
}
