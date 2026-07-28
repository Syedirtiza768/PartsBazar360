/**
 * Renders an InfographicSpec to a self-contained SVG.
 *
 * SVG rather than a rasterised PNG on object storage, because the gallery draws
 * images with a plain <img> tag: the browser renders SVG natively, the payload
 * is a couple of kilobytes instead of a few hundred, it stays crisp on any
 * display, and there is no bucket, no credentials and no native image toolchain
 * to keep alive. Rendering is pure string work, so it happens per request behind
 * HTTP caching rather than being stored.
 *
 * The card sits beside seller photos, so the body is set as a document — hairline
 * rules, no heavy panels — and only the header carries weight.
 */

import type { InfographicSpec } from './infographic-spec';

const W = 1000;
/**
 * The canvas grows to fit its content between these bounds rather than being
 * fixed square. A three-row card on a 1000px canvas is mostly empty space; the
 * gallery scales with object-contain, so a shorter card simply centres in the
 * stage and reads as deliberate.
 */
const H_MIN = 520;
const H_MAX = 1000;

/** Design tokens mirrored from packages/ui/tailwind-preset.cjs. */
const COLORS = {
  bg: '#ffffff',
  /** canvas.DEFAULT — the highlights well. */
  canvas: '#f4f2ed',
  /** canvas.sunk — hairlines and the outer border. */
  sunk: '#ebe8e1',
  /** graphite-950 — headings and the header ground. */
  ink: '#0d1519',
  /** graphite-700 — body copy. */
  body: '#33434b',
  /** graphite-600 — labels and muted text. */
  muted: '#4a5a63',
  /** brand-500 — the teal keyline and eyebrow. */
  brand: '#1f8582',
  /** brand-700 — eyebrow on light grounds. */
  brandDeep: '#105656',
  /** signal-500 — badge and bullets. Carries ink text, never white. */
  signal: '#f36b21',
  onDark: '#ffffff',
};

// System stacks: no webfont fetch, so the card renders identically offline and
// never flashes unstyled text.
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const PAD = 56;

/**
 * Escapes text for XML content and attribute values.
 *
 * Load-bearing: spec text is model-generated and originates from seller-supplied
 * listings, so an unescaped angle bracket would break the document and an
 * unescaped payload could inject markup into a document the browser executes.
 */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/** Drops control characters that are illegal in XML even when escaped. */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function truncate(value: string, max: number): string {
  const clean = sanitize(value).trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function text(
  value: string,
  attrs: Record<string, string | number>,
  max: number,
): string {
  const body = escapeXml(truncate(value, max));
  const rendered = Object.entries(attrs)
    .map(([key, val]) => `${key}="${escapeXml(String(val))}"`)
    .join(' ');
  return `<text ${rendered}>${body}</text>`;
}

/** Greedy word wrap into at most `maxLines` lines of `maxChars`. */
function wrap(value: string, maxChars: number, maxLines: number): string[] {
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
    lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars);
  }
  return lines.slice(0, maxLines);
}

/** Part numbers and codes read better monospaced. */
function isCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-./ ]{3,}$/.test(value) && /\d/.test(value);
}

/** An eyebrow: 900 weight, uppercase, widely tracked. */
function eyebrow(
  value: string,
  x: number,
  y: number,
  fill: string,
  anchor?: 'end',
): string {
  return text(
    value.toUpperCase(),
    {
      x,
      y,
      fill,
      'font-family': SANS,
      'font-size': 19,
      'font-weight': 900,
      'letter-spacing': 3.4,
      ...(anchor ? { 'text-anchor': anchor } : {}),
    },
    26,
  );
}

export interface RenderOptions {
  /** Shown as an eyebrow above the fitment line; omitted when absent. */
  brand?: string | null;
  /** Small print at the foot of the card. */
  footnote?: string;
}

/**
 * Returns a complete SVG document. Pure and deterministic: the same spec always
 * renders the same bytes, which is what makes ETag caching safe.
 */
export function renderInfographicSvg(
  spec: InfographicSpec,
  options: RenderOptions = {},
): string {
  const parts: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  const headlineLines = wrap(spec.headline, 30, 2);
  const headerH = 148 + (headlineLines.length - 1) * 46;

  parts.push(
    `<path d="M1 25 A24 24 0 0 1 25 1 L${W - 25} 1 A24 24 0 0 1 ${W - 1} 25 L${W - 1} ${headerH} L1 ${headerH} Z" fill="${COLORS.ink}"/>`,
    `<rect x="1" y="${headerH - 5}" width="${W - 2}" height="5" fill="${COLORS.brand}"/>`,
    eyebrow('Specifications', PAD, 54, COLORS.brand),
  );

  headlineLines.forEach((line, index) => {
    parts.push(
      text(
        line,
        {
          x: PAD,
          y: 106 + index * 46,
          fill: COLORS.onDark,
          'font-family': SANS,
          'font-size': 38,
          'font-weight': 800,
        },
        34,
      ),
    );
  });

  if (spec.badge) {
    const badge = truncate(spec.badge.toUpperCase(), 14);
    // The system stack averages ~0.62em at this weight and tracking.
    const badgeW = Math.max(96, Math.round(badge.length * 14.5) + 40);
    parts.push(
      `<rect x="${W - PAD - badgeW}" y="30" width="${badgeW}" height="42" rx="8" fill="${COLORS.signal}"/>`,
      text(
        badge,
        {
          x: W - PAD - badgeW / 2,
          y: 58,
          // Ink on signal, never white: white on signal-500 is only 3.03:1.
          fill: COLORS.ink,
          'font-family': SANS,
          'font-size': 19,
          'font-weight': 900,
          'text-anchor': 'middle',
          'letter-spacing': 1.2,
        },
        14,
      ),
    );
  }

  // ── Attribution and fitment ───────────────────────────────────────────────
  let y = headerH + 56;
  let hasIntro = false;
  if (options.brand) {
    parts.push(eyebrow(options.brand, PAD, y, COLORS.brandDeep));
    y += 40;
    hasIntro = true;
  }
  if (spec.subheadline) {
    hasIntro = true;
    for (const line of wrap(spec.subheadline, 50, 2)) {
      parts.push(
        text(
          line,
          {
            x: PAD,
            y,
            fill: COLORS.muted,
            'font-family': SANS,
            'font-size': 26,
          },
          56,
        ),
      );
      y += 36;
    }
  }

  // ── Spec rows ─────────────────────────────────────────────────────────────
  // Hairline rules rather than a filled panel: fewer rows set larger, read as a
  // document beside the photos instead of a second banner.
  // Without an intro line the rows would otherwise float well below the header.
  y += hasIntro ? 30 : 6;
  const rowHeight = 74;
  const rows = spec.specs.slice(0, 4);

  rows.forEach((row, index) => {
    if (index > 0) {
      parts.push(
        `<line x1="${PAD}" y1="${y - 28}" x2="${W - PAD}" y2="${y - 28}" stroke="${COLORS.sunk}" stroke-width="1.5"/>`,
      );
    }
    parts.push(
      text(
        row.label.toUpperCase(),
        {
          x: PAD,
          y: y + 10,
          fill: COLORS.muted,
          'font-family': SANS,
          'font-size': 20,
          'font-weight': 900,
          'letter-spacing': 2.4,
        },
        20,
      ),
      text(
        row.value,
        {
          x: W - PAD,
          y: y + 10,
          fill: COLORS.ink,
          'font-family': isCode(row.value) ? MONO : SANS,
          'font-size': 30,
          'font-weight': 700,
          'text-anchor': 'end',
        },
        26,
      ),
    );
    y += rowHeight;
  });

  let contentBottom = y - rowHeight + 32;

  // ── Highlights ────────────────────────────────────────────────────────────
  const highlights = spec.highlights.slice(0, 3);
  if (highlights.length) {
    const wellTop = contentBottom + 24;
    const wellH = highlights.length * 48 + 36;
    // Only draw the well if it fits above the footnote; overflow would collide.
    if (wellTop + wellH <= H_MAX - 76) {
      parts.push(
        `<rect x="40" y="${wellTop}" width="${W - 80}" height="${wellH}" rx="16" fill="${COLORS.canvas}"/>`,
      );
      let hy = wellTop + 52;
      for (const highlight of highlights) {
        parts.push(
          `<rect x="${PAD + 10}" y="${hy - 15}" width="8" height="8" rx="2" fill="${COLORS.signal}"/>`,
          text(
            highlight,
            {
              x: PAD + 34,
              y: hy,
              fill: COLORS.body,
              'font-family': SANS,
              'font-size': 25,
            },
            46,
          ),
        );
        hy += 48;
      }
      contentBottom = wellTop + wellH;
    }
  }

  // Size the canvas to the content, leaving room for the footnote.
  const H = Math.min(
    H_MAX,
    Math.max(H_MIN, Math.round(contentBottom + (options.footnote ? 84 : 44))),
  );

  const footnote = options.footnote
    ? text(
        options.footnote,
        {
          x: PAD,
          y: H - 36,
          fill: COLORS.muted,
          'font-family': MONO,
          'font-size': 17,
        },
        76,
      )
    : '';

  const title = escapeXml(truncate(spec.headline, 80));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="24" fill="none" stroke="${COLORS.sunk}" stroke-width="2"/>`,
    ...parts,
    footnote,
    '</svg>',
  ].join('');
}
