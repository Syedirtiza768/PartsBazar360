/**
 * Deterministic automotive query understanding (brief §6).
 *
 * Regex + dictionary only. No AI in the request path: query interpretation runs
 * on every search and must be fast, reproducible, and debuggable. A token the
 * parser does not recognise is left in `freeText` rather than guessed at, so
 * the parser can only ever *add* precision — never invent a vehicle.
 */

import {
  CHASSIS_CODES,
  CONDITION_TERMS,
  MAKE_LOOKUP,
  MODEL_LOOKUP,
  POSITION_TERMS,
  SIDE_TERMS,
  SYNONYM_INDEX,
  multiWordKeys,
  type Condition,
  type Position,
  type Side,
} from './automotive-vocabulary';
import {
  extractPartNumberCandidatesDetailed,
  partNumberConfidence,
} from './part-number.util';

/**
 * Display casing for a model key. Short alpha runs and alpha runs glued to
 * digits are manufacturer designations and stay upper-case ("a6" → "A6",
 * "cx-5" → "CX-5", "f-150" → "F-150"); longer words are title-cased
 * ("corolla" → "Corolla", "grand cherokee" → "Grand Cherokee").
 */
export function formatModelLabel(model: string): string {
  return model.replace(/[a-z]+/g, (word, offset: number, whole: string) => {
    const nextChar = whole[offset + word.length];
    if (word.length <= 2 || /\d/.test(nextChar ?? '')) return word.toUpperCase();
    return word[0].toUpperCase() + word.slice(1);
  });
}

export interface ParsedQuery {
  /** Exactly what the buyer typed. */
  original: string;
  /** Whitespace-collapsed, lowercased. */
  normalized: string;
  /** Normalized part-number candidates, most confident first. */
  partNumbers: string[];
  /** Per-candidate collision confidence, keyed by the normalized number. */
  partNumberConfidence: Record<string, number>;
  /** Single model year, when exactly one was found. */
  year?: number;
  /** Inclusive year range, when the buyer typed one ("2015-2018"). */
  yearRange?: { from: number; to: number };
  make?: string;
  model?: string;
  chassis?: string;
  engine?: string;
  /** Litre displacement, e.g. 2.8 from "Audi A6 2.8". */
  engineLitres?: number;
  side?: Side;
  positions: Position[];
  condition?: Condition;
  /** Synonym-group labels the query matched, for the "we searched for" note. */
  synonymGroups: string[];
  /** Every term to search, original terms plus their synonyms. */
  expandedTerms: string[];
  /** Tokens the parser did not claim — the descriptive part of the query. */
  freeText: string;
  /**
   * The text the *matching* clauses should run over: the whole query minus
   * part numbers and minus years.
   *
   * Distinct from `freeText`, which has make/model/side/position removed and
   * exists to drive synonym lookup and part-type classification.
   *
   * Matching cannot use `freeText`, because the structured `makes`/`models`
   * fields are empty on most salvage documents. Dropping "audi" from the text
   * query left nothing enforcing the make, so "Audi Bumper" and "Audi Q7
   * bumper" both returned the identical 2,373 results — every bumper in the
   * catalogue, Nissan and MINI included. Years stay out because a part that
   * fits 2015–2020 rarely has "2018" in its title.
   */
  matchText: string;
}

/**
 * Words that carry no automotive meaning but would otherwise become required
 * match terms. Kept deliberately short — only true function words, never a
 * word that could name or qualify a part.
 */
const MATCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'is', 'my',
  'of', 'on', 'or', 'the', 'to', 'with', 'fits', 'fit', 'suit', 'suits',
]);

const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/g;
const YEAR_RANGE_RE = /\b(19[5-9]\d|20[0-4]\d)\s*[-–—/]\s*(19[5-9]\d|20[0-4]\d)\b/;
/** "2.8", "2.0l", "3.5 litre" — displacement, not a year or a part number. */
const LITRE_RE = /\b(\d\.\d)\s*(?:l\b|liter|litre|ltr)?/i;
/** Engine codes: 3+ alphanumerics with both letters and digits, e.g. N54, M113, EJ255. */
const ENGINE_CODE_RE = /^[a-z]{1,3}\d{2,3}[a-z]?$/i;

const MULTIWORD_MAKES = multiWordKeys(MAKE_LOOKUP.keys());
const MULTIWORD_MODELS = multiWordKeys(MODEL_LOOKUP.keys());
const MULTIWORD_SIDES = multiWordKeys(Object.keys(SIDE_TERMS));
const MULTIWORD_CONDITIONS = multiWordKeys(Object.keys(CONDITION_TERMS));
const MULTIWORD_SYNONYMS = multiWordKeys(SYNONYM_INDEX.keys());

/** Remove `phrase` from `text` if present, returning [found, remaining]. */
function takePhrase(text: string, phrase: string): [boolean, string] {
  const re = new RegExp(`(^|\\s)${escapeRe(phrase)}(?=\\s|$)`, 'i');
  if (!re.test(text)) return [false, text];
  return [true, text.replace(re, ' ').replace(/\s+/g, ' ').trim()];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseQuery(raw: string): ParsedQuery {
  const original = String(raw ?? '');
  const normalized = original.trim().replace(/\s+/g, ' ').toLowerCase();

  const result: ParsedQuery = {
    original,
    normalized,
    partNumbers: [],
    partNumberConfidence: {},
    positions: [],
    synonymGroups: [],
    expandedTerms: [],
    freeText: '',
    matchText: '',
  };
  if (!normalized) return result;

  // --- 1. Part numbers. Extracted from the ORIGINAL casing so multi-token
  //        manufacturer formats ("A 221 820 02 64") survive. ---
  const originalTokens = original.trim().split(/\s+/).filter(Boolean);
  // Some tokens have part-number shape but name a platform or a model:
  // "W221", "F10", "E46" are chassis codes; "F-150", "A6", "CX-5", "911" are
  // models. Dropping them here lets the chassis/model passes claim them
  // instead of sending the buyer after a nonexistent part number.
  const isVehicleToken = (token: string) => {
    const key = token.toLowerCase();
    return Boolean(CHASSIS_CODES[key]) || MODEL_LOOKUP.has(key);
  };
  const candidates = extractPartNumberCandidatesDetailed(original).filter(
    (candidate) =>
      !(
        candidate.tokenIndices.length === 1 &&
        isVehicleToken(originalTokens[candidate.tokenIndices[0]] ?? '')
      ),
  );
  result.partNumbers = candidates.map((c) => c.value);
  for (const candidate of result.partNumbers) {
    result.partNumberConfidence[candidate] = partNumberConfidence(candidate);
  }

  // Drop every token a part-number candidate consumed, so the digits of
  // "A 221 820 02 64" are not also matched as descriptive words.
  const consumed = new Set<number>();
  for (const candidate of candidates) {
    for (const index of candidate.tokenIndices) consumed.add(index);
  }
  let rest = original
    .trim()
    .split(/\s+/)
    .filter((_, index) => !consumed.has(index))
    .join(' ')
    .toLowerCase();

  // Snapshot before make/model/side/position are stripped — this is what the
  // matching clauses run over. See ParsedQuery.matchText.
  const beforeVehicleStripping = rest;

  // --- 2. Years. Range first so "2015-2018" is not read as two single years. ---
  const rangeMatch = rest.match(YEAR_RANGE_RE);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    if (from <= to) result.yearRange = { from, to };
    else result.yearRange = { from: to, to: from };
    rest = rest.replace(rangeMatch[0], ' ').replace(/\s+/g, ' ').trim();
  } else {
    const years = [...rest.matchAll(YEAR_RE)].map((m) => Number(m[1]));
    // Only claim a year when it is unambiguous. Two loose years are more
    // likely a listing title fragment than a buyer's intent.
    if (years.length === 1) {
      result.year = years[0];
      rest = rest.replace(String(years[0]), ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // --- 3. Chassis codes (imply a make). ---
  for (const token of rest.split(' ')) {
    const code = CHASSIS_CODES[token];
    if (code) {
      result.chassis = code.label;
      result.make ??= code.make;
      [, rest] = takePhrase(rest, token);
      break;
    }
  }

  // --- 4. Make. Multi-word aliases first ("land rover" before "rover").
  //        Runs even when a chassis code already implied the make, so an
  //        explicit "BMW F10 …" strips both tokens instead of leaving "bmw"
  //        behind in the descriptive remainder. ---
  let makeFound = false;
  for (const phrase of MULTIWORD_MAKES) {
    const [found, remaining] = takePhrase(rest, phrase);
    if (found) {
      result.make ??= MAKE_LOOKUP.get(phrase);
      rest = remaining;
      makeFound = true;
      break;
    }
  }
  if (!makeFound) {
    for (const token of rest.split(' ')) {
      const make = MAKE_LOOKUP.get(token);
      if (make) {
        result.make ??= make;
        [, rest] = takePhrase(rest, token);
        break;
      }
    }
  }

  // --- 5. Model. Constrained to the detected make when we have one, so
  //        "Civic" cannot resolve against Toyota. ---
  const modelMatches = (entry: { make: string } | undefined) =>
    !!entry && (!result.make || entry.make === result.make);

  for (const phrase of MULTIWORD_MODELS) {
    const entry = MODEL_LOOKUP.get(phrase);
    if (!modelMatches(entry)) continue;
    const [found, remaining] = takePhrase(rest, phrase);
    if (found) {
      result.model = formatModelLabel(entry!.model);
      result.make ??= entry!.make;
      rest = remaining;
      break;
    }
  }
  if (!result.model) {
    for (const token of rest.split(' ')) {
      const entry = MODEL_LOOKUP.get(token);
      if (modelMatches(entry)) {
        result.model = formatModelLabel(entry!.model);
        result.make ??= entry!.make;
        [, rest] = takePhrase(rest, token);
        break;
      }
    }
  }

  // --- 6. Engine displacement and engine code. ---
  const litreMatch = rest.match(LITRE_RE);
  if (litreMatch) {
    const litres = Number(litreMatch[1]);
    if (litres >= 0.6 && litres <= 8.5) {
      result.engineLitres = litres;
      rest = rest.replace(litreMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }
  for (const token of rest.split(' ')) {
    // Only after make/model are resolved, and never a token already claimed as
    // a part number, so "0125141" is not read as an engine code.
    if (
      ENGINE_CODE_RE.test(token) &&
      !result.partNumbers.includes(token.toUpperCase())
    ) {
      result.engine = token.toUpperCase();
      [, rest] = takePhrase(rest, token);
      break;
    }
  }

  // --- 7. Side. ---
  for (const phrase of MULTIWORD_SIDES) {
    const [found, remaining] = takePhrase(rest, phrase);
    if (found) {
      result.side = SIDE_TERMS[phrase];
      rest = remaining;
      break;
    }
  }
  if (!result.side) {
    for (const token of rest.split(' ')) {
      const side = SIDE_TERMS[token];
      if (side) {
        result.side = side;
        [, rest] = takePhrase(rest, token);
        break;
      }
    }
  }

  // --- 8. Positions (a part can be both "front" and "upper"). ---
  for (const token of rest.split(' ')) {
    const position = POSITION_TERMS[token];
    if (position && !result.positions.includes(position)) {
      result.positions.push(position);
    }
  }
  for (const position of result.positions) {
    for (const [term, mapped] of Object.entries(POSITION_TERMS)) {
      if (mapped === position) [, rest] = takePhrase(rest, term);
    }
  }

  // --- 9. Condition. ---
  for (const phrase of MULTIWORD_CONDITIONS) {
    const [found, remaining] = takePhrase(rest, phrase);
    if (found) {
      result.condition = CONDITION_TERMS[phrase];
      rest = remaining;
      break;
    }
  }
  if (!result.condition) {
    for (const token of rest.split(' ')) {
      const condition = CONDITION_TERMS[token];
      if (condition) {
        result.condition = condition;
        [, rest] = takePhrase(rest, token);
        break;
      }
    }
  }

  result.freeText = rest.replace(/\s+/g, ' ').trim();

  // matchText = everything except part numbers, years, and stopwords.
  //
  // Years are dropped because fitment is a range: a bumper listed as
  // "2015-2020" has no "2018" in its title.
  //
  // Stopwords are dropped because they are required terms otherwise: with
  // "for" left in, "front bumper for 2018 Accord" matched "FEBEST front brake
  // caliper repair kit (set for one side)" on front+for and pushed the actual
  // Accord bumpers off the first page.
  result.matchText = beforeVehicleStripping
    .split(' ')
    .filter(
      (token) =>
        token &&
        !/^(19[5-9]\d|20[0-4]\d)$/.test(token) &&
        !MATCH_STOPWORDS.has(token),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // --- 11. Synonym expansion over what is left. ---
  const expanded = new Set<string>();
  const groups = new Set<string>();
  let synonymScan = result.freeText;

  for (const phrase of MULTIWORD_SYNONYMS) {
    if (!synonymScan.includes(phrase)) continue;
    const group = SYNONYM_INDEX.get(phrase);
    if (!group) continue;
    groups.add(group[0]);
    for (const term of group) expanded.add(term);
    synonymScan = synonymScan.replace(phrase, ' ').replace(/\s+/g, ' ').trim();
  }
  for (const token of synonymScan.split(' ').filter(Boolean)) {
    const group = SYNONYM_INDEX.get(token);
    if (group) {
      groups.add(group[0]);
      for (const term of group) expanded.add(term);
    }
  }

  result.synonymGroups = [...groups];
  // Expanded terms are the free text plus any synonyms it pulled in.
  if (result.freeText) expanded.add(result.freeText);
  result.expandedTerms = [...expanded];

  return result;
}

/**
 * True when the query is essentially "just a part number" — every meaningful
 * token was consumed as an identifier. The ranking layer uses this to tighten
 * matching: a bare number should return the part, not 3,000 loose word matches.
 */
export function isPartNumberQuery(parsed: ParsedQuery): boolean {
  return parsed.partNumbers.length > 0 && parsed.freeText.length === 0;
}
