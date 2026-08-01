/**
 * Guards the identifier fields (`manufacturerPartNumber`, `oeNumbers`) against
 * descriptive text written by the ingest pipelines.
 *
 * Why this matters more than it looks: these two fields carry the highest
 * query-time boosts in `browseParts` (`manufacturerPartNumber^3`,
 * `oeNumbers^2`) and they hold a single short token, so BM25 field-length
 * normalisation is at its maximum for them. A document whose MPN is the
 * literal string "BUMPER" therefore outscores a genuine seven-token title
 * that matches *both* query terms.
 *
 * That is not hypothetical. For `q=Audi bumper` the live top five were:
 *   1. Porsche Cayenne Bumper Vent Grille   manufacturerPartNumber = "BUMPER"
 *   2. Audi Q7 Stone Guard                  manufacturerPartNumber = "AUDI"
 *   3. Audi Q7 Fender Liner Support         manufacturerPartNumber = "AUDI"
 *   4. BMW E39 Bumper Cover                 oeNumbers = ["BUMPER"]
 *   5. VW Beetle Bumper Grille              oeNumbers = ["BUMPER"]
 * The first real Audi bumper was rank 6.
 *
 * The rule: a real automotive identifier contains at least one digit.
 * Dropped:  "BUMPER", "AUDI", "Unknown", "N/A", "-"
 * Kept:     "8R0807453C", "5C5853665D/9B9", "955-505-682-10-9B9", "3BO 807 217 A"
 *
 * This is an *indexing* guard, not a data migration — it keeps the corruption
 * out of the scoring fields regardless of what Postgres currently holds, so
 * search is correct after a reindex even before the rows are cleaned up.
 */

/** Shortest string that could plausibly be a part number. */
const MIN_IDENTIFIER_LENGTH = 3;

/**
 * True when `value` looks like a part identifier rather than a description.
 * Requires at least one digit, which every automotive OE/MPN scheme uses and
 * no bare part-name word ("BUMPER", "AUDI") does.
 */
export function isIndexableIdentifier(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_IDENTIFIER_LENGTH) return false;
  return /\d/.test(trimmed);
}

/** Normalise a single identifier, or null when it is descriptive text. */
export function sanitizeIdentifier(value: unknown): string | null {
  return isIndexableIdentifier(value) ? (value as string).trim() : null;
}

/**
 * Filter an identifier array, trimming and de-duplicating survivors.
 *
 * Note: elements are filtered whole. Some feeds emit comma-joined elements
 * (`"955-505-682-10-9B9, 955 505 682 109 B9"`); those are kept as-is here
 * because splitting them changes match behaviour and belongs in ingest, not
 * in an index-time guard.
 */
export function sanitizeIdentifierList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const clean = sanitizeIdentifier(raw);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
