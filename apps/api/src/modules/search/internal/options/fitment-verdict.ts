/**
 * Fitment verdicts for staff search — precision first.
 *
 * Evidence in production (2026-10-27) is graded "B / VERIFIED" almost
 * everywhere, but most of it is derived from listing titles (TITLE_MVL expands
 * "2010-2013 Audi Q5" in a title to every engine of those years). The letter
 * grade alone would therefore overstate confidence, so verdicts are decided by
 * the *kind* of evidence:
 *
 *   strong  – catalogue / compatibility-table data: Febest application lists,
 *             eBay compatibility tables (EBAY_MVL), catalogue imports
 *             (e.g. LEMFORDER_FCPEURO_MVL), manual, VIN or OEM cross-reference.
 *   medium  – title-parsed or back-filled vehicle matches (TITLE_MVL,
 *             MVL_MATCH, other TITLE_PARSE), seller declarations, grade C/D.
 *
 * Verdicts:
 *   fits         – strong evidence for the vehicle, and the engine is either
 *                  the one documented or irrelevant (every engine documented).
 *   likely       – medium evidence, or strong evidence with the engine unknown.
 *   unverified   – no evidence for this vehicle (may list what *is* documented).
 *   does_not_fit – explicit conflict only (e.g. wrong side). A missing row is
 *                  never treated as proof of non-fit.
 *   universal    – no vehicle-specific data and the part says it is universal.
 */

import { classifySide } from '../../index/part-type-classifier';

export type Verdict =
  'fits' | 'likely' | 'unverified' | 'does_not_fit' | 'universal';

export const VERDICT_ORDER: Verdict[] = [
  'fits',
  'likely',
  'universal',
  'unverified',
  'does_not_fit',
];

export type EvidenceStrength = 'strong' | 'medium';

export interface EvidenceRow {
  vehicleConfigId: string;
  evidenceType: string;
  evidenceLevel: string;
  source: string | null;
  verificationStatus: string;
}

export interface ResolvedVehicle {
  label: string;
  make: string;
  model: string;
  year: number;
  /** Litres the user specified (picker / VIN), if any. */
  engineLitres?: number;
  /** Single configuration chosen explicitly. */
  exactConfigId?: string;
  configIds: string[];
  /** configId → parsed engine litres (null when the config has no engine text). */
  configLitres: Record<string, number | null>;
}

export interface VerdictResult {
  verdict: Verdict;
  reason: string;
  evidence: Array<{ type: string; source: string; strength: EvidenceStrength }>;
}

const STRONG_TYPES = new Set([
  'FEBEST_WEBSITE',
  'EBAY_MVL',
  'EBAY_COMPATIBILITY',
  'MANUAL',
  'VIN',
  'OEM_CROSS_REFERENCE',
]);

/** Catalogue imports recorded as TITLE_PARSE but sourced from an application list. */
const CATALOGUE_SOURCE_RE = /(LEMFORDER|FCPEURO|FEBEST|CATALOG|TECDOC|EPC)/i;

export function evidenceStrength(
  row: Pick<
    EvidenceRow,
    'evidenceType' | 'evidenceLevel' | 'source' | 'verificationStatus'
  >,
): EvidenceStrength {
  const graded =
    ['A', 'B'].includes(String(row.evidenceLevel).toUpperCase()) &&
    row.verificationStatus === 'VERIFIED';
  if (!graded) return 'medium';
  if (STRONG_TYPES.has(row.evidenceType)) return 'strong';
  if (
    row.evidenceType === 'TITLE_PARSE' &&
    CATALOGUE_SOURCE_RE.test(row.source ?? '')
  )
    return 'strong';
  return 'medium';
}

export function evidenceLabel(
  row: Pick<EvidenceRow, 'evidenceType' | 'source'>,
): string {
  switch (row.evidenceType) {
    case 'FEBEST_WEBSITE':
      return 'Febest catalogue application list';
    case 'EBAY_MVL':
      return 'eBay compatibility table (checked against eBay vehicle list)';
    case 'TITLE_MVL':
      return 'Vehicle named in listing title';
    case 'MVL_MATCH':
      return 'Back-filled from listing compatibility / title';
    case 'TITLE_PARSE':
      return CATALOGUE_SOURCE_RE.test(row.source ?? '')
        ? `Catalogue import (${row.source})`
        : 'Parsed from listing title';
    case 'VIN':
      return 'VIN-confirmed';
    case 'MANUAL':
      return 'Manually confirmed';
    case 'OEM_CROSS_REFERENCE':
      return 'OEM cross-reference';
    default:
      return row.evidenceType;
  }
}

/** "1968 ccm" → 2.0, "2.0L 1984CC" → 2.0, "2.0 TDI" → 2.0, "3.0" → 3.0. */
export function parseEngineLitres(
  text: string | null | undefined,
): number | null {
  const value = String(text ?? '');
  if (!value.trim()) return null;
  const litres =
    value.match(
      /(?:^|[^\d.])(\d\.\d)\s*(?:l\b|litre|liter|tdi|tfsi|tsi|fsi|v\d|i\d|\s|$)/i,
    ) ?? value.match(/^(\d\.\d)$/);
  if (litres) return Number(litres[1]);
  const cc = value.match(/(\d{3,4})\s*(?:cc|ccm|cm3|cm³)\b/i);
  if (cc) return Math.round(Number(cc[1]) / 100) / 10;
  return null;
}

function sameLitres(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.051;
}

/** Side conflict is explicit evidence: a RIGHT part is not an answer to "left". */
export function sideConflict(
  querySide: 'LEFT' | 'RIGHT' | undefined,
  partTitle: string,
  partPosition?: string | null,
): 'LEFT' | 'RIGHT' | null {
  if (!querySide) return null;
  const partSide = classifySide(`${partTitle ?? ''} ${partPosition ?? ''}`);
  return partSide && partSide !== querySide ? partSide : null;
}

const UNIVERSAL_RE = /\buniversal\b/i;

export interface VerdictInput {
  vehicle: ResolvedVehicle | null;
  /** Evidence rows for this part restricted to vehicle.configIds. */
  evidence: EvidenceRow[];
  /** compatibility JSON lists this year/make/model (no Fitment row needed). */
  compatibilityListsVehicle: boolean;
  /** Human summary of what *is* documented, e.g. "Audi A4 2009–2016". */
  documented: string | null;
  hasAnyFitment: boolean;
  title: string;
  position?: string | null;
  querySide?: 'LEFT' | 'RIGHT';
}

export function decideVerdict(input: VerdictInput): VerdictResult | null {
  const conflict = sideConflict(input.querySide, input.title, input.position);
  if (conflict) {
    return {
      verdict: 'does_not_fit',
      reason: `${conflict === 'RIGHT' ? 'Right' : 'Left'}-side part; you asked for ${input.querySide === 'LEFT' ? 'left' : 'right'}`,
      evidence: [],
    };
  }
  const vehicle = input.vehicle;
  if (!vehicle) return null;

  const evidence = new Map<
    string,
    { type: string; source: string; strength: EvidenceStrength }
  >();
  const strongConfigs = new Set<string>();
  let medium = false;
  for (const row of input.evidence) {
    const strength = evidenceStrength(row);
    if (strength === 'strong') strongConfigs.add(row.vehicleConfigId);
    else medium = true;
    const label = evidenceLabel(row);
    const existing = evidence.get(label);
    if (
      !existing ||
      (existing.strength === 'medium' && strength === 'strong')
    ) {
      evidence.set(label, { type: row.evidenceType, source: label, strength });
    }
  }
  const evidenceList = [...evidence.values()].sort((a, b) =>
    a.strength === b.strength ? 0 : a.strength === 'strong' ? -1 : 1,
  );

  if (strongConfigs.size > 0) {
    if (vehicle.exactConfigId && strongConfigs.has(vehicle.exactConfigId)) {
      return {
        verdict: 'fits',
        reason: `Documented for this exact ${vehicle.label} configuration`,
        evidence: evidenceList,
      };
    }
    const coveredLitres = new Set<number>();
    let unspecified = false;
    for (const id of strongConfigs) {
      const litres = vehicle.configLitres[id];
      if (litres == null) unspecified = true;
      else coveredLitres.add(litres);
    }
    const ymmLitres = new Set<number>(
      Object.values(vehicle.configLitres).filter(
        (value): value is number => value != null,
      ),
    );
    const covered = [...coveredLitres].sort();
    const coveredText = covered.map((l) => l.toFixed(1)).join(', ');
    if (vehicle.engineLitres != null) {
      if (covered.some((l) => sameLitres(l, vehicle.engineLitres!))) {
        return {
          verdict: 'fits',
          reason: `Documented for ${vehicle.label} with the ${vehicle.engineLitres.toFixed(1)} L engine`,
          evidence: evidenceList,
        };
      }
      if (covered.length) {
        return {
          verdict: 'unverified',
          reason: `Documented for ${vehicle.label} ${coveredText} L only — not your ${vehicle.engineLitres.toFixed(1)} L`,
          evidence: evidenceList,
        };
      }
      return {
        verdict: 'likely',
        reason: `Documented for ${vehicle.label}; engine not specified in our data`,
        evidence: evidenceList,
      };
    }
    const allEngines =
      ymmLitres.size > 0 &&
      [...ymmLitres].every((l) => covered.some((c) => sameLitres(c, l)));
    if (allEngines) {
      return {
        verdict: 'fits',
        reason: `Documented for every ${vehicle.label} engine (${coveredText} L)`,
        evidence: evidenceList,
      };
    }
    return {
      verdict: 'likely',
      reason: covered.length
        ? `Documented for ${vehicle.label} ${coveredText} L — select the engine to confirm`
        : unspecified
          ? `Documented for ${vehicle.label}; engine not specified in our data`
          : `Documented for ${vehicle.label}`,
      evidence: evidenceList,
    };
  }

  if (medium) {
    return {
      verdict: 'likely',
      reason: `Matched to ${vehicle.label} from listing data, not a catalogue`,
      evidence: evidenceList,
    };
  }
  if (input.compatibilityListsVehicle) {
    return {
      verdict: 'likely',
      reason: `${vehicle.label} appears in the part's compatibility list`,
      evidence: [
        {
          type: 'COMPATIBILITY_LIST',
          source: 'Compatibility list on the part',
          strength: 'medium',
        },
      ],
    };
  }
  if (!input.hasAnyFitment && UNIVERSAL_RE.test(input.title)) {
    return {
      verdict: 'universal',
      reason: 'Universal part — check dimensions and connectors',
      evidence: [],
    };
  }
  return {
    verdict: 'unverified',
    reason: input.documented
      ? `No fitment data for ${vehicle.label}. Documented for: ${input.documented}`
      : `No fitment data for ${vehicle.label}`,
    evidence: [],
  };
}

/** Compact "Audi Q5 2009–2017; Audi SQ5 2013–2017 (+3 more)" summary. */
export function summarizeDocumented(
  rows: Array<{
    make: string;
    model: string;
    minYear: number;
    maxYear: number;
  }>,
  limit = 3,
): string | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort(
    (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
  );
  const shown = sorted.slice(0, limit).map((row) => {
    const years =
      row.minYear === row.maxYear
        ? `${row.minYear}`
        : `${row.minYear}–${row.maxYear}`;
    return `${row.make} ${row.model} ${years}`;
  });
  const extra = sorted.length - shown.length;
  return extra > 0 ? `${shown.join('; ')} (+${extra} more)` : shown.join('; ');
}
