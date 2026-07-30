/**
 * Generates a product spec card SVG for parts — identical layout to the
 * AI-generated infographic (same tokens, same header, same spec rows,
 * same highlights well) but populated from the part's identity fields
 * instead of an LLM-generated spec.
 *
 * Used as the gallery image for parts without seller photos. Renders as
 * a normal product card, not a "placeholder" or "no photo" notice.
 *
 * Self-contained: no external fonts, images, or CDN dependencies.
 * Deterministic: same input → same bytes (ETag-safe).
 */

const W = 1000;
const H_MIN = 520;
const H_MAX = 1000;
const PAD = 56;

const COLORS = {
  bg: '#ffffff',
  canvas: '#f4f2ed',
  sunk: '#ebe8e1',
  ink: '#0d1519',
  body: '#33434b',
  muted: '#4a5a63',
  brand: '#1f8582',
  brandDeep: '#105656',
  signal: '#f36b21',
  onDark: '#ffffff',
};

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function trunc(value: string, max: number): string {
  const clean = sanitize(value).trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}

function text(
  value: string,
  attrs: Record<string, string | number>,
  max: number,
): string {
  const body = esc(trunc(value, max));
  const rendered = Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(' ');
  return `<text ${rendered}>${body}</text>`;
}

function isCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-./ ]{3,}$/.test(value) && /\d/.test(value);
}

/** Greedy word wrap into at most maxLines lines of maxChars. */
function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = sanitize(value).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = trunc(lines[maxLines - 1], maxChars);
  }
  return lines.slice(0, maxLines);
}

export interface PlaceholderSpec {
  title: string;
  brand?: string | null;
  mpn?: string | null;
  category?: string | null;
  condition?: string | null;
  partSource?: string | null;
  position?: string | null;
  oeNumbers?: string[] | null;
  highlights?: string[] | null;
}

export function renderPlaceholderSvg(spec: PlaceholderSpec): string {
  const parts: string[] = [];

  const title = trunc(spec.title, 120);
  const brand = spec.brand?.trim() ? trunc(spec.brand, 40) : null;
  const mpn = spec.mpn?.trim() ? trunc(spec.mpn, 40) : null;
  const category = spec.category?.trim() ? trunc(spec.category, 30) : null;
  const condition = spec.condition?.trim() ? trunc(spec.condition, 26) : null;
  const partSource = spec.partSource?.trim()?.toUpperCase() || null;
  const position = spec.position?.trim() ? trunc(spec.position, 26) : null;
  const oeNumbers = spec.oeNumbers?.filter((n) => n?.trim()).slice(0, 3) || [];

  // ── Header ────────────────────────────────────────────────────────────────
  // Title wraps into up to 2 lines; header height adapts.
  const headlineLines = wrapText(title, 30, 2);
  const headerH = 148 + (headlineLines.length - 1) * 46;

  parts.push(
    `<path d="M1 25 A24 24 0 0 1 25 1 L${W - 25} 1 A24 24 0 0 1 ${W - 1} 25 L${W - 1} ${headerH} L1 ${headerH} Z" fill="${COLORS.ink}"/>`,
    `<rect x="1" y="${headerH - 5}" width="${W - 2}" height="5" fill="${COLORS.brand}"/>`,
  );

  // Category eyebrow (top-left)
  if (category) {
    parts.push(
      text(category.toUpperCase(), {
        x: PAD, y: 54,
        fill: COLORS.brand,
        'font-family': SANS,
        'font-size': 19,
        'font-weight': 900,
        'letter-spacing': 3.4,
      }, 26),
    );
  }

  // Badge (top-right) — OEM / AFTERMARKET / Genuine etc.
  const badge = partSource || null;
  if (badge) {
    const badgeW = Math.max(96, Math.round(badge.length * 14.5) + 40);
    parts.push(
      `<rect x="${W - PAD - badgeW}" y="30" width="${badgeW}" height="42" rx="8" fill="${COLORS.signal}"/>`,
      text(badge, {
        x: W - PAD - badgeW / 2, y: 58,
        fill: COLORS.ink,
        'font-family': SANS,
        'font-size': 19,
        'font-weight': 900,
        'text-anchor': 'middle',
        'letter-spacing': 1.2,
      }, 14),
    );
  }

  // Title lines in header (white on dark, wraps naturally)
  headlineLines.forEach((line, i) => {
    parts.push(
      text(line, {
        x: PAD,
        y: 106 + i * 46,
        fill: COLORS.onDark,
        'font-family': SANS,
        'font-size': 38,
        'font-weight': 800,
      }, 34),
    );
  });

  // ── Brand eyebrow ─────────────────────────────────────────────────────────
  let y = headerH + 56;
  if (brand) {
    parts.push(
      text(brand, {
        x: PAD, y,
        fill: COLORS.brandDeep,
        'font-family': SANS,
        'font-size': 19,
        'font-weight': 900,
        'letter-spacing': 3.4,
      }, 26),
    );
    y += 40;
  }

  // ── Spec rows ─────────────────────────────────────────────────────────────
  const rowHeight = 74;
  const specRows: { label: string; value: string }[] = [];
  if (mpn) specRows.push({ label: 'Part Number', value: mpn });
  if (oeNumbers.length > 1) specRows.push({ label: 'OE Numbers', value: oeNumbers.join(', ') });
  if (condition) specRows.push({ label: 'Condition', value: condition });
  if (position) specRows.push({ label: 'Position', value: position });
  if (category && !specRows.find(r => r.value === category)) {
    specRows.push({ label: 'Category', value: category });
  }

  const rows = specRows.slice(0, 4);
  rows.forEach((row, index) => {
    if (index > 0) {
      parts.push(
        `<line x1="${PAD}" y1="${y - 28}" x2="${W - PAD}" y2="${y - 28}" stroke="${COLORS.sunk}" stroke-width="1.5"/>`,
      );
    }
    parts.push(
      text(row.label.toUpperCase(), {
        x: PAD,
        y: y + 10,
        fill: COLORS.muted,
        'font-family': SANS,
        'font-size': 20,
        'font-weight': 900,
        'letter-spacing': 2.4,
      }, 20),
      text(row.value, {
        x: W - PAD,
        y: y + 10,
        fill: COLORS.ink,
        'font-family': isCode(row.value) ? MONO : SANS,
        'font-size': 30,
        'font-weight': 700,
        'text-anchor': 'end',
      }, 26),
    );
    y += rowHeight;
  });

  let contentBottom = y - rowHeight + 32;

  // ── Highlights well (only caller-supplied highlights, no fabrications) ────
  const highlights = (spec.highlights || []).filter((h) => h?.trim()).slice(0, 3);

  if (highlights.length) {
    const wellTop = contentBottom + 24;
    const wellH = highlights.length * 48 + 36;
    if (wellTop + wellH <= H_MAX - 44) {
      parts.push(
        `<rect x="40" y="${wellTop}" width="${W - 80}" height="${wellH}" rx="16" fill="${COLORS.canvas}"/>`,
      );
      let hy = wellTop + 52;
      for (const h of highlights) {
        parts.push(
          `<rect x="${PAD + 10}" y="${hy - 15}" width="8" height="8" rx="2" fill="${COLORS.signal}"/>`,
          text(h, {
            x: PAD + 34, y: hy,
            fill: COLORS.body,
            'font-family': SANS,
            'font-size': 25,
          }, 46),
        );
        hy += 48;
      }
      contentBottom = wellTop + wellH;
    }
  }

  // ── Canvas sizing ─────────────────────────────────────────────────────────
  const H = Math.min(H_MAX, Math.max(H_MIN, Math.round(contentBottom + 44)));
  const titleAttr = esc(trunc(title, 80));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${titleAttr}">`,
    `<title>${titleAttr}</title>`,
    `<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="24" fill="none" stroke="${COLORS.sunk}" stroke-width="2"/>`,
    ...parts,
    '</svg>',
  ].join('');
}
