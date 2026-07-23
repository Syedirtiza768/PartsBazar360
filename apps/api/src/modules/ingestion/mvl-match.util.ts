/**
 * Normalize vehicle make/model strings for US MVL lookups.
 */
export function normalizeMvlToken(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

export interface MvlYmmCandidate {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  engine?: string | null;
  source?: string;
}

export interface MvlMatchResult {
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  epid: string | null;
  matched: true;
}

/**
 * Strip common platform/chassis codes from FEBEST-style model strings
 * e.g. "RANGER ES" → try "RANGER ES" then "RANGER".
 */
export function modelLookupVariants(model: string): string[] {
  const raw = String(model || '').trim();
  if (!raw) return [];
  const variants = [raw];
  // Drop trailing chassis code tokens like "ES", "ACA2#", "F10"
  const withoutCode = raw.replace(/\s+[A-Z0-9#-]{1,8}$/i, '').trim();
  if (withoutCode && withoutCode.toLowerCase() !== raw.toLowerCase()) {
    variants.push(withoutCode);
  }
  // First token only as last resort for multi-word models
  const first = raw.split(/\s+/)[0];
  if (first && !variants.some((v) => v.toLowerCase() === first.toLowerCase())) {
    variants.push(first);
  }
  return [...new Set(variants)];
}

export function expandYears(startYear: number, endYear: number, maxSpan = 40): number[] {
  const from = Math.min(startYear, endYear);
  const to = Math.max(startYear, endYear);
  const years: number[] = [];
  for (let y = from; y <= Math.min(to, from + maxSpan); y++) years.push(y);
  return years;
}
