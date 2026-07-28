/**
 * Normalizes seller-supplied weights and package dimensions to kg / cm.
 *
 * Shipping is billed on max(actual, volumetric) weight, so a wrong unit is a
 * direct revenue error rather than a cosmetic one. Every helper here returns an
 * explicit confidence plus warnings so an ambiguous cell can be surfaced as an
 * upload review reason instead of silently becoming a quote.
 */

export type WeightUnit = 'kg' | 'g' | 'lb' | 'oz';
export type DimensionUnit = 'cm' | 'mm' | 'm' | 'in';

export interface NormalizedWeight {
  kg: number;
  sourceUnit: WeightUnit;
  /** True when the unit came from the cell text rather than a job-level default. */
  unitExplicit: boolean;
  confidence: number;
  warnings: string[];
}

export interface DimensionsCm {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface NormalizedDimensions extends DimensionsCm {
  sourceUnit: DimensionUnit;
  unitExplicit: boolean;
  confidence: number;
  warnings: string[];
}

const KG_PER_UNIT: Record<WeightUnit, number> = {
  kg: 1,
  g: 0.001,
  lb: 0.45359237,
  oz: 0.028349523125,
};

const CM_PER_UNIT: Record<DimensionUnit, number> = {
  cm: 1,
  mm: 0.1,
  m: 100,
  in: 2.54,
};

const WEIGHT_UNIT_ALIASES: Record<string, WeightUnit> = {
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  g: 'g',
  gr: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
};

const DIMENSION_UNIT_ALIASES: Record<string, DimensionUnit> = {
  cm: 'cm',
  cms: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  millimetre: 'mm',
  millimetres: 'mm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
};

/**
 * Sanity envelope for a single auto part. Anything outside this is far more
 * likely to be a unit mistake or a merged cell than a real measurement.
 */
const MIN_PLAUSIBLE_KG = 0.005;
const MAX_PLAUSIBLE_KG = 2000;
const MIN_PLAUSIBLE_CM = 0.1;
const MAX_PLAUSIBLE_CM = 600;

export function parseWeightUnit(
  value: string | null | undefined,
): WeightUnit | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/[.\s]/g, '');
  return WEIGHT_UNIT_ALIASES[key] ?? null;
}

export function parseDimensionUnit(
  value: string | null | undefined,
): DimensionUnit | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/[.\s]/g, '');
  return DIMENSION_UNIT_ALIASES[key] ?? null;
}

/**
 * Reads a decimal out of a spreadsheet cell, tolerating European comma
 * decimals ("2,5"), thousands separators ("1,250.5") and unit suffixes.
 */
export function parseNumericCell(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const text = raw.trim();
  if (!text) return null;

  // Strip everything except digits and separators so "≈ 2,5 kg" still parses.
  let numeric = text.replace(/[^0-9.,-]/g, '').replace(/(?!^)-/g, '');
  if (!numeric || numeric === '-') return null;

  const hasComma = numeric.includes(',');
  const hasDot = numeric.includes('.');

  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal point.
    numeric =
      numeric.lastIndexOf(',') > numeric.lastIndexOf('.')
        ? numeric.replace(/\./g, '').replace(',', '.')
        : numeric.replace(/,/g, '');
  } else if (hasComma) {
    const parts = numeric.split(',');
    const isThousands =
      parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    numeric = isThousands
      ? numeric.replace(/,/g, '')
      : numeric.replace(',', '.');
  }

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pulls a trailing/leading unit out of a cell such as "2.5 kg" or "kg 2.5". */
function extractWeightUnitFromText(text: string): WeightUnit | null {
  const matches = text.toLowerCase().match(/[a-z"]+/g);
  if (!matches) return null;
  for (const token of matches) {
    const unit = parseWeightUnit(token);
    if (unit) return unit;
  }
  return null;
}

function extractDimensionUnitFromText(text: string): DimensionUnit | null {
  const matches = text.toLowerCase().match(/[a-z"]+/g);
  if (!matches) return null;
  for (const token of matches) {
    const unit = parseDimensionUnit(token);
    if (unit) return unit;
  }
  return null;
}

export interface NormalizeWeightInput {
  value: string | number | null | undefined;
  /** Unit confirmed for the whole upload job (SellerUploadJob.defaultWeightUnit). */
  defaultUnit?: string | null;
  /** Unit from a per-row unit column, if the sheet has one. */
  rowUnit?: string | null;
}

export function normalizeWeight({
  value,
  defaultUnit,
  rowUnit,
}: NormalizeWeightInput): NormalizedWeight | null {
  const amount = parseNumericCell(value);
  if (amount === null || amount <= 0) return null;

  const warnings: string[] = [];
  const text = typeof value === 'string' ? value : '';

  const inlineUnit = extractWeightUnitFromText(text);
  const explicitUnit = inlineUnit ?? parseWeightUnit(rowUnit);
  const fallbackUnit = parseWeightUnit(defaultUnit);

  let unit: WeightUnit;
  let unitExplicit: boolean;
  if (explicitUnit) {
    unit = explicitUnit;
    unitExplicit = true;
  } else if (fallbackUnit) {
    unit = fallbackUnit;
    unitExplicit = false;
  } else {
    // Most catalogs in this marketplace are metric and quote kg. Assume kg but
    // mark low confidence so the row still asks for confirmation.
    unit = 'kg';
    unitExplicit = false;
    warnings.push('Weight unit not specified — assumed kg');
  }

  let kg = round(amount * KG_PER_UNIT[unit], 4);
  let confidence = unitExplicit ? 0.95 : fallbackUnit ? 0.8 : 0.45;

  if (kg < MIN_PLAUSIBLE_KG) {
    warnings.push(`Weight ${kg}kg is implausibly light for a part`);
    confidence = Math.min(confidence, 0.3);
  }
  if (kg > MAX_PLAUSIBLE_KG) {
    warnings.push(`Weight ${kg}kg exceeds the plausible single-part maximum`);
    confidence = Math.min(confidence, 0.3);
    kg = MAX_PLAUSIBLE_KG;
  }

  return { kg, sourceUnit: unit, unitExplicit, confidence, warnings };
}

export interface NormalizeDimensionsInput {
  length?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  /** Single cell such as "30 x 20 x 15 cm"; used when discrete columns are absent. */
  raw?: string | null;
  defaultUnit?: string | null;
  rowUnit?: string | null;
}

export function normalizeDimensions(
  input: NormalizeDimensionsInput,
): NormalizedDimensions | null {
  const fromColumns = readDiscreteDimensions(input);
  const triple = fromColumns ?? readCombinedDimensions(input.raw);
  if (!triple) return null;

  const warnings = [...triple.warnings];
  const explicitUnit =
    triple.inlineUnit ?? parseDimensionUnit(input.rowUnit) ?? null;
  const fallbackUnit = parseDimensionUnit(input.defaultUnit);

  let unit: DimensionUnit;
  let unitExplicit: boolean;
  if (explicitUnit) {
    unit = explicitUnit;
    unitExplicit = true;
  } else if (fallbackUnit) {
    unit = fallbackUnit;
    unitExplicit = false;
  } else {
    unit = 'cm';
    unitExplicit = false;
    warnings.push('Dimension unit not specified — assumed cm');
  }

  const factor = CM_PER_UNIT[unit];
  const lengthCm = round(triple.values[0] * factor, 2);
  const widthCm = round(triple.values[1] * factor, 2);
  const heightCm = round(triple.values[2] * factor, 2);

  let confidence = unitExplicit ? 0.95 : fallbackUnit ? 0.8 : 0.45;
  for (const cm of [lengthCm, widthCm, heightCm]) {
    if (cm < MIN_PLAUSIBLE_CM || cm > MAX_PLAUSIBLE_CM) {
      warnings.push(`Dimension ${cm}cm is outside the plausible range`);
      confidence = Math.min(confidence, 0.3);
    }
  }

  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) return null;

  return {
    lengthCm,
    widthCm,
    heightCm,
    sourceUnit: unit,
    unitExplicit,
    confidence,
    warnings,
  };
}

interface DimensionTriple {
  values: [number, number, number];
  inlineUnit: DimensionUnit | null;
  warnings: string[];
}

function readDiscreteDimensions(
  input: NormalizeDimensionsInput,
): DimensionTriple | null {
  const length = parseNumericCell(input.length);
  const width = parseNumericCell(input.width);
  const height = parseNumericCell(input.height);
  if (length === null || width === null || height === null) return null;
  if (length <= 0 || width <= 0 || height <= 0) return null;

  const inlineUnit = [input.length, input.width, input.height]
    .map((value) =>
      typeof value === 'string' ? extractDimensionUnitFromText(value) : null,
    )
    .find((unit): unit is DimensionUnit => Boolean(unit));

  return {
    values: [length, width, height],
    inlineUnit: inlineUnit ?? null,
    warnings: [],
  };
}

/** Parses "30x20x15", "30 × 20 × 15 cm", "30*20*15mm". */
function readCombinedDimensions(
  raw: string | null | undefined,
): DimensionTriple | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const numbers = text
    .split(/\s*[x×*/]\s*|\s*-\s*/i)
    .map((part) => parseNumericCell(part))
    .filter((value): value is number => value !== null && value > 0);

  if (numbers.length < 3) return null;

  const warnings =
    numbers.length > 3
      ? [`Dimension cell "${text}" had more than three values — used the first three`]
      : [];

  return {
    values: [numbers[0], numbers[1], numbers[2]],
    inlineUnit: extractDimensionUnitFromText(text),
    warnings,
  };
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface ResolvedShippingMetrics {
  weightKg: number | null;
  weightConfidence: number | null;
  dimensionsCm: DimensionsCm | null;
  dimensionsConfidence: number | null;
  warnings: string[];
}

/**
 * Resolves the shipping metrics for one spreadsheet row.
 *
 * Gross weight wins over net: carriers bill the packed parcel, not the bare
 * part. Net weight is only used when gross is absent.
 */
export function resolveShippingMetrics(raw: {
  netWeight?: string | null;
  grossWeight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  dimensionsRaw?: string | null;
  weightUnit?: string | null;
  dimensionUnit?: string | null;
  defaultWeightUnit?: string | null;
  defaultDimensionUnit?: string | null;
}): ResolvedShippingMetrics {
  const warnings: string[] = [];

  const gross = normalizeWeight({
    value: raw.grossWeight,
    defaultUnit: raw.defaultWeightUnit,
    rowUnit: raw.weightUnit,
  });
  const net = gross
    ? null
    : normalizeWeight({
        value: raw.netWeight,
        defaultUnit: raw.defaultWeightUnit,
        rowUnit: raw.weightUnit,
      });
  const weight = gross ?? net;
  if (weight) warnings.push(...weight.warnings);

  const dimensions = normalizeDimensions({
    length: raw.length,
    width: raw.width,
    height: raw.height,
    raw: raw.dimensionsRaw,
    defaultUnit: raw.defaultDimensionUnit,
    rowUnit: raw.dimensionUnit,
  });
  if (dimensions) warnings.push(...dimensions.warnings);

  return {
    weightKg: weight?.kg ?? null,
    weightConfidence: weight?.confidence ?? null,
    dimensionsCm: dimensions
      ? {
          lengthCm: dimensions.lengthCm,
          widthCm: dimensions.widthCm,
          heightCm: dimensions.heightCm,
        }
      : null,
    dimensionsConfidence: dimensions?.confidence ?? null,
    warnings,
  };
}
