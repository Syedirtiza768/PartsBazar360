import { escapeXml, renderInfographicSvg } from './infographic-renderer';
import { normalizeSpec, type InfographicSpec } from './infographic-spec';

const baseSpec: InfographicSpec = {
  headline: 'Front Brake Caliper Assembly',
  subheadline: 'Fits Toyota Land Cruiser 200 Series 2008-2021',
  badge: 'OEM',
  specs: [
    { label: 'Part Number', value: '47730-60280' },
    { label: 'Position', value: 'Front Right' },
    { label: 'Material', value: 'Cast Iron' },
    { label: 'Condition', value: 'Remanufactured' },
  ],
  highlights: ['Includes mounting bracket', 'Pressure tested before dispatch'],
};

describe('escapeXml', () => {
  it('escapes every character that can break a document', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('escapes ampersands before the entities it produces', () => {
    // A naive sequential replace yields "&amp;lt;" here.
    expect(escapeXml('&<')).toBe('&amp;&lt;');
  });
});

describe('renderInfographicSvg', () => {
  it('produces a well-formed, self-contained SVG document', () => {
    const svg = renderInfographicSvg(baseSpec, { brand: 'Toyota' });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 1000 \d+"/);
    // No external resources: the card must render offline and without a fetch.
    // The xmlns declaration is the one permitted URL.
    expect(svg).not.toMatch(/<image|xlink:href|@import|url\(/);
    expect(svg.match(/https?:\/\//g)).toEqual(['http://']);
  });

  it('renders the supplied content', () => {
    const svg = renderInfographicSvg(baseSpec, { brand: 'Toyota' });

    expect(svg).toContain('47730-60280');
    expect(svg).toContain('Front Right');
    expect(svg).toContain('TOYOTA');
    expect(svg).toContain('Includes mounting bracket');
  });

  it('neutralises markup injected through spec text', () => {
    const svg = renderInfographicSvg({
      ...baseSpec,
      headline: '<script>alert(1)</script>',
      specs: [
        { label: 'A&B', value: '"><script>x</script>' },
        { label: 'Two', value: 'ok' },
        { label: 'Three', value: 'ok' },
      ],
    });

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A&amp;B');
  });

  it('escapes the accessible label as well as the body', () => {
    const svg = renderInfographicSvg({
      ...baseSpec,
      headline: 'Caliper "OEM" & Bracket',
    });

    // aria-label is an attribute, so an unescaped quote would break the tag.
    expect(svg).toMatch(/aria-label="[^"]*&quot;OEM&quot;[^"]*"/);
  });

  it('strips control characters that are illegal even when escaped', () => {
    const svg = renderInfographicSvg({
      ...baseSpec,
      headline: 'Brake\u0000 Cal\u0007iper',
    });

    expect(svg).not.toMatch(/[\u0000-\u0008]/);
  });

  it('is deterministic, so ETag caching stays correct', () => {
    const a = renderInfographicSvg(baseSpec, { brand: 'Toyota' });
    const b = renderInfographicSvg(baseSpec, { brand: 'Toyota' });
    expect(a).toBe(b);
  });

  it('handles a minimal spec without optional fields', () => {
    const svg = renderInfographicSvg({
      headline: 'Oil Filter',
      specs: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
        { label: 'C', value: '3' },
      ],
      highlights: [],
    });

    expect(svg).toContain('Oil Filter');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('truncates overlong text instead of overflowing the card', () => {
    const svg = renderInfographicSvg({
      ...baseSpec,
      specs: [
        { label: 'X'.repeat(200), value: 'Y'.repeat(200) },
        { label: 'B', value: '2' },
        { label: 'C', value: '3' },
      ],
    });

    expect(svg).not.toContain('X'.repeat(60));
    expect(svg).toContain('…');
  });

  it('keeps the card inside its bounds with maximum content', () => {
    const svg = renderInfographicSvg({
      headline: 'A very long product headline that will need to wrap twice over',
      subheadline: 'And a subheadline that is also comfortably long enough to wrap',
      badge: 'REMANUFACTURED',
      specs: Array.from({ length: 6 }, (_, i) => ({
        label: `Label ${i}`,
        value: `Value ${i}`,
      })),
      highlights: Array.from({ length: 4 }, (_, i) => `Highlight number ${i}`),
    });

    // Nothing may be positioned past the canvas it declares.
    const height = Number(svg.match(/viewBox="0 0 1000 (\d+)"/)![1]);
    const ys = [...svg.matchAll(/\by="(\d+(?:\.\d+)?)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(height).toBeLessThanOrEqual(1000);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height);
  });

  it('shrinks the canvas for a sparse card and grows it for a full one', () => {
    const heightOf = (svg: string) =>
      Number(svg.match(/viewBox="0 0 1000 (\d+)"/)![1]);

    const sparse = renderInfographicSvg({
      headline: 'Turbocharger Assembly',
      specs: [
        { label: 'Condition', value: 'Used' },
        { label: 'Position', value: 'Rear' },
        { label: 'Weight', value: '11.2 kg' },
      ],
      highlights: [],
    });
    const dense = renderInfographicSvg({
      headline: 'A long headline that wraps onto a second line for the card',
      subheadline: 'And a subheadline long enough to occupy its own full line',
      specs: Array.from({ length: 6 }, (_, i) => ({
        label: `Label ${i}`,
        value: `Value ${i}`,
      })),
      highlights: Array.from({ length: 4 }, (_, i) => `Highlight ${i}`),
    });

    // A three-row card on a full-height canvas would be mostly empty space.
    expect(heightOf(sparse)).toBeLessThan(700);
    expect(heightOf(dense)).toBeGreaterThan(heightOf(sparse));
    expect(heightOf(dense)).toBeLessThanOrEqual(1000);
    // width/height attributes must agree with the viewBox or the card distorts.
    expect(sparse).toContain(`height="${heightOf(sparse)}"`);
  });
});

describe('normalizeSpec', () => {
  it('accepts and trims a valid spec', () => {
    const spec = normalizeSpec({
      headline: '  Front Brake Caliper  ',
      subheadline: '',
      badge: '',
      specs: [
        { label: 'Part Number', value: '47730-60280' },
        { label: 'Position', value: 'Front' },
        { label: 'Material', value: 'Iron' },
      ],
      highlights: ['Tested'],
    });

    expect(spec).not.toBeNull();
    expect(spec!.headline).toBe('Front Brake Caliper');
    // Empty optional fields are dropped rather than rendered blank.
    expect(spec!.subheadline).toBeUndefined();
    expect(spec!.badge).toBeUndefined();
  });

  it('rejects a spec too thin to look intentional', () => {
    expect(
      normalizeSpec({
        headline: 'Oil Filter',
        specs: [{ label: 'A', value: '1' }],
        highlights: [],
      }),
    ).toBeNull();
  });

  it('rejects a spec with no headline', () => {
    expect(
      normalizeSpec({
        headline: '   ',
        specs: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
          { label: 'C', value: '3' },
        ],
      }),
    ).toBeNull();
  });

  it('drops incomplete spec rows', () => {
    const spec = normalizeSpec({
      headline: 'Caliper',
      specs: [
        { label: 'A', value: '1' },
        { label: 'B', value: '' },
        { label: '', value: '3' },
        { label: 'D', value: '4' },
        { label: 'E', value: '5' },
      ],
      highlights: [],
    });

    expect(spec!.specs).toHaveLength(3);
  });

  it('rejects junk input', () => {
    expect(normalizeSpec(null)).toBeNull();
    expect(normalizeSpec('nope')).toBeNull();
    expect(normalizeSpec({})).toBeNull();
  });
});
