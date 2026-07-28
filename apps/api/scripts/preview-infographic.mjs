// Renders sample infographics to tmp/ so the card design can be reviewed in a
// browser without an API key, a database, or a running stack.
//
//   cd apps/api && npx nest build && node scripts/preview-infographic.mjs
//
// Then open the generated .svg files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = resolve(process.cwd(), 'dist/src/modules/enrichment');
const { renderInfographicSvg } = await import(
  pathToFileURL(resolve(dist, 'infographic-renderer.js')).href
);

const SAMPLES = [
  {
    file: 'infographic-caliper.svg',
    brand: 'Toyota',
    footnote: 'Part number 47730-60280 · Specifications supplied by the seller',
    spec: {
      headline: 'Front Brake Caliper Assembly',
      subheadline: 'Fits Land Cruiser 200 Series 2008-2021',
      badge: 'OEM',
      specs: [
        { label: 'Part Number', value: '47730-60280' },
        { label: 'Position', value: 'Front Right' },
        { label: 'Material', value: 'Cast Iron' },
        { label: 'Condition', value: 'Remanufactured' },
        { label: 'Shipping Weight', value: '6.4 kg' },
      ],
      highlights: [
        'Includes mounting bracket and bleed screw',
        'Pressure tested before dispatch',
        'Direct replacement, no modification needed',
      ],
    },
  },
  {
    file: 'infographic-minimal.svg',
    brand: null,
    footnote: 'Specifications supplied by the seller',
    spec: {
      headline: 'Turbocharger Assembly',
      specs: [
        { label: 'Condition', value: 'Used' },
        { label: 'Position', value: 'Rear' },
        { label: 'Shipping Weight', value: '11.2 kg' },
      ],
      highlights: [],
    },
  },
  {
    file: 'infographic-maximal.svg',
    brand: 'Mercedes-Benz',
    footnote: 'Part number A0009050342 · Specifications supplied by the seller',
    spec: {
      headline: 'Air Suspension Compressor Pump With Relay Kit',
      subheadline: 'Fits W222 S-Class and W166 ML/GLE 2013 onwards',
      badge: 'REMANUFACTURED',
      specs: [
        { label: 'Part Number', value: 'A0009050342' },
        { label: 'Position', value: 'Front Under Wheel Arch' },
        { label: 'Material', value: 'Aluminium and Composite' },
        { label: 'Condition', value: 'Remanufactured' },
        { label: 'Shipping Weight', value: '4.8 kg' },
        { label: 'Warranty', value: '24 Months' },
      ],
      highlights: [
        'Supplied with relay and mounting hardware',
        'Bench tested to full working pressure',
        'Replaces earlier revision A0009050142',
        'Fitting requires no coding or calibration',
      ],
    },
  },
];

const outDir = resolve(process.cwd(), '../../tmp');
mkdirSync(outDir, { recursive: true });

for (const { file, spec, brand, footnote } of SAMPLES) {
  const svg = renderInfographicSvg(spec, { brand, footnote });
  const target = resolve(outDir, file);
  writeFileSync(target, svg, 'utf8');
  console.log(`${target}  (${(svg.length / 1024).toFixed(1)} KB)`);
}
