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
  const name = cleaned(value);
  const key = catalogIdentityKey(name);
  if (!key || key === '-') return null;
  if (MODEL_ONLY_MAKES[key]) return MODEL_ONLY_MAKES[key];
  return makeLookup.get(key) ?? name;
}

export function canonicalizeCatalogBrand(value: unknown): string | null {
  const name = cleaned(value);
  const key = catalogIdentityKey(name);
  if (!key || NON_BRANDS.has(key)) return null;
  if (name.length > 80 || name.split(/\s+/).length > 9) return null;

  const productBrand = productBrandLookup.get(key);
  if (productBrand) return productBrand;

  const make = makeLookup.get(key) ?? MODEL_ONLY_MAKES[key];
  if (make) return make;

  // Unknown product brands use a stable casing so case-only variants still
  // collapse into one bucket. Vehicle makes are already covered above.
  return name.toUpperCase();
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
