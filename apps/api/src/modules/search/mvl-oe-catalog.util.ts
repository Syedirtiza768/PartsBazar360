/**
 * Pure helpers for OE-catalog-style fitment expansion from MVL vehicle rows.
 * MVL has no OE→vehicle index; we expand donor/seed YMM to the chassis
 * generation (partsModel / region codes like X260) so the PDP can show all
 * trims/engines/years for that platform — matching OEM catalog tables.
 */

/** Chassis / platform codes commonly stored in MVL partsModel or region. */
const CHASSIS_CODE_RE = /\b([A-Z]{1,3}\d{2,3}[A-Z]?)\b/g;

/** Tokens that look like codes but are model names or noise. */
const CHASSIS_BLOCKLIST = new Set([
  'RWD',
  'AWD',
  'FWD',
  'SUV',
  'VAN',
  'GT',
  'GTS',
  'RS',
  'AMG',
  'M',
  'S',
  'SE',
  'SEL',
  'X',
  'II',
  'III',
  'IV',
]);

export type MvlCatalogSeed = {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  engine?: string | null;
};

export type MvlCatalogRow = {
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  source: 'mvl_catalog';
  mvlVerified: true;
  epid?: string | null;
  platform?: string | null;
};

/**
 * Extract a chassis/platform code from MVL partsModel or region fields.
 * Prefers exact partsModel when it is itself a code (e.g. "X260").
 */
export function extractChassisPlatform(
  partsModel?: string | null,
  region?: string | null,
  modelName?: string | null,
): string | null {
  const modelNorm = String(modelName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const candidates: string[] = [];
  for (const raw of [partsModel, region]) {
    const text = String(raw || '').trim().toUpperCase();
    if (!text) continue;
    // Exact single-token code
    if (/^[A-Z]{1,3}\d{2,3}[A-Z]?$/.test(text)) {
      candidates.push(text);
      continue;
    }
    CHASSIS_CODE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHASSIS_CODE_RE.exec(text)) !== null) {
      candidates.push(match[1]);
    }
  }

  for (const code of candidates) {
    if (CHASSIS_BLOCKLIST.has(code)) continue;
    if (modelNorm && code === modelNorm) continue;
    // Prefer codes that include a digit (X260, F15, W205, …)
    if (!/\d/.test(code)) continue;
    return code;
  }
  return null;
}

/** True when the part carries at least one OE / genuine OEM number. */
export function partHasOeNumber(input: {
  oeNumbers?: string[] | null;
  genuineOemPartNumber?: string | null;
  manufacturerPartNumber?: string | null;
  partSource?: string | null;
}): boolean {
  if (
    Array.isArray(input.oeNumbers) &&
    input.oeNumbers.some((n) => String(n || '').trim().length > 0)
  ) {
    return true;
  }
  if (String(input.genuineOemPartNumber || '').trim()) return true;
  // Genuine OEM listings often only put the OE in manufacturerPartNumber.
  if (
    String(input.partSource || '').toUpperCase() === 'OEM' &&
    String(input.manufacturerPartNumber || '').trim()
  ) {
    return true;
  }
  return false;
}

/**
 * Sparse tables (donor-only / title-only) benefit from catalog expansion.
 * Rich tables already look like OEM catalogs — leave them alone.
 */
export function shouldExpandOeCatalog(
  rows: Array<{ year?: number | string; make?: string; model?: string }>,
): boolean {
  if (rows.length === 0) return true;
  if (rows.length <= 3) return true;
  const years = new Set<number>();
  for (const row of rows) {
    const y =
      typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
    if (Number.isFinite(y)) years.add(y);
  }
  return years.size <= 2;
}

export function parseSeedYear(year: number | string | null | undefined): number | null {
  if (typeof year === 'number' && Number.isFinite(year)) return year;
  const n = parseInt(String(year ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function dedupeCatalogRows(rows: MvlCatalogRow[]): MvlCatalogRow[] {
  const seen = new Set<string>();
  const out: MvlCatalogRow[] = [];
  for (const row of rows) {
    const key = [
      row.year,
      row.make.toLowerCase(),
      row.model.toLowerCase(),
      (row.trim || '-').toLowerCase(),
      (row.engine || '-').toLowerCase(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const makeCmp = a.make.localeCompare(b.make);
    if (makeCmp) return makeCmp;
    const modelCmp = a.model.localeCompare(b.model);
    if (modelCmp) return modelCmp;
    return (a.trim || '').localeCompare(b.trim || '');
  });
}

/** Collapse per-trim rows into make/model year-range chips for the PDP. */
export function summarizeCompatibleVehicles(
  rows: MvlCatalogRow[],
): Array<{
  label: string;
  make: string;
  model: string;
  startYear: number;
  endYear: number;
  evidenceLevel: string;
  confidence: number;
}> {
  type Agg = { make: string; model: string; start: number; end: number };
  const byKey = new Map<string, Agg>();
  for (const row of rows) {
    const key = `${row.make.toLowerCase()}|${row.model.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        make: row.make,
        model: row.model,
        start: row.year,
        end: row.year,
      });
      continue;
    }
    existing.start = Math.min(existing.start, row.year);
    existing.end = Math.max(existing.end, row.year);
  }
  return [...byKey.values()].map((v) => {
    const years =
      v.start === v.end ? `${v.start}` : `${v.start}-${v.end}`;
    return {
      label: `${years} ${v.make} ${v.model}`,
      make: v.make,
      model: v.model,
      startYear: v.start,
      endYear: v.end,
      evidenceLevel: 'B',
      confidence: 0.9,
    };
  });
}
