/**
 * eBay Motors–style location / OEM callout diagram prompts for enrichment.
 *
 * Two paths:
 * 1. OEM exploded diagram + TARGET_CALLOUT_NUMBER → highlight only that callout
 * 2. No OEM diagram → illustrative location guide from the seller photo
 *    (never invent an OEM diagram)
 */

export interface LocationDiagramListingData {
  listingTitle: string;
  partName: string;
  oemPartNumber: string;
  targetCalloutNumber: string;
  year: string;
  make: string;
  model: string;
  trimOrChassis: string;
  engine: string;
  partPosition: string;
  quantityIncluded: number;
  otherIncludedComponents: string;
}

export type LocationDiagramMode = 'oem_callout' | 'location_guide';

const OEM_NEGATIVE = `Do not generate a fictional exploded diagram. Do not modify the original assembly arrangement. Do not highlight multiple components unless explicitly listed. Do not add imaginary bolts, brackets, wiring, connectors, modules or mounting hardware. Do not remove reference numbers. Do not invent OEM information. Do not show the complete assembly as included. No photorealistic car, workshop, mechanic, hands, tools, packaging, watermark, eBay branding, price badge, promotional text, excessive colors, gradients or illegible text.`;

const GUIDE_NEGATIVE = `Do not create an exploded assembly. Do not invent mounting hardware, connectors, part numbers, adjacent components or technical details. Do not fabricate an OEM diagram. No eBay logo, pricing, watermark, workshop background, or promotional text.`;

function fill(template: string, data: LocationDiagramListingData): string {
  const qty = Math.max(1, Number(data.quantityIncluded) || 1);
  const includedStatement =
    qty > 1
      ? `HIGHLIGHTED COMPONENTS ONLY — QUANTITY: ${qty}`
      : 'HIGHLIGHTED COMPONENT ONLY';

  return template
    .replaceAll('{{LISTING_TITLE}}', data.listingTitle || 'Unknown')
    .replaceAll('{{PART_NAME}}', data.partName || 'Automotive part')
    .replaceAll('{{OEM_PART_NUMBER}}', data.oemPartNumber || 'Not verified')
    .replaceAll(
      '{{TARGET_CALLOUT_NUMBER}}',
      data.targetCalloutNumber || 'N/A',
    )
    .replaceAll('{{YEAR}}', data.year || '')
    .replaceAll('{{MAKE}}', data.make || '')
    .replaceAll('{{MODEL}}', data.model || '')
    .replaceAll('{{TRIM_OR_CHASSIS}}', data.trimOrChassis || 'Not specified')
    .replaceAll('{{ENGINE}}', data.engine || 'Not specified')
    .replaceAll('{{PART_POSITION}}', data.partPosition || 'Not specified')
    .replaceAll('{{QUANTITY_INCLUDED}}', String(qty))
    .replaceAll(
      '{{OTHER_INCLUDED_COMPONENTS_OR_NONE}}',
      data.otherIncludedComponents || 'None',
    )
    .replaceAll('{{INCLUDED_STATEMENT}}', includedStatement);
}

const OEM_PROMPT = `You are an automotive parts diagram designer creating a professional secondary
image for an eBay Motors used-parts listing.

OBJECTIVE
Transform the supplied OEM exploded-parts diagram into a clean listing image
that clearly identifies the exact component included in the sale.

SOURCE-OF-TRUTH RULES
1. Use the uploaded OEM diagram as the only source of component geometry,
   assembly arrangement, reference numbers, and part location.
2. Preserve the original shape, position, orientation, and reference number of
   every component.
3. Do not redraw, replace, reposition, add, remove, or invent mechanical parts.
4. Do not invent an OEM part number, callout number, fitment, vehicle detail,
   mounting point, connector, or included accessory.
5. Highlight only the component identified by TARGET_CALLOUT_NUMBER.
6. If the target component cannot be located with high confidence, return:
   "MANUAL REVIEW REQUIRED — TARGET COMPONENT NOT VERIFIED"
   and do not generate the final listing image.

LISTING DATA
Listing title: {{LISTING_TITLE}}
Part name: {{PART_NAME}}
OEM part number: {{OEM_PART_NUMBER}}
Diagram callout number: {{TARGET_CALLOUT_NUMBER}}
Vehicle: {{YEAR}} {{MAKE}} {{MODEL}}
Trim or chassis: {{TRIM_OR_CHASSIS}}
Engine: {{ENGINE}}
Part position: {{PART_POSITION}}
Quantity included: {{QUANTITY_INCLUDED}}
Additional included components: {{OTHER_INCLUDED_COMPONENTS_OR_NONE}}

IMAGE DESIGN
Create a square 1600 × 1600 px automotive listing infographic.

Background:
- Pure white
- Clean, professional and uncluttered
- No decorative environment or automotive workshop background

Diagram:
- Place the original exploded diagram prominently in the center
- Make the diagram occupy approximately 75% of the canvas
- Keep all original reference numbers readable
- Increase line sharpness and contrast without changing the technical content
- Render non-included components in light neutral gray
- Highlight the included component in a solid high-contrast teal
- Add a thin dark outline around the highlighted component
- Add one clean arrow or callout pointing to it
- Display: "ITEM {{TARGET_CALLOUT_NUMBER}}" beside the callout

Header:
PART LOCATION DIAGRAM

Identification panel:
PART: {{PART_NAME}}
OEM NUMBER: {{OEM_PART_NUMBER}}
POSITION: {{PART_POSITION}}
VEHICLE: {{YEAR}} {{MAKE}} {{MODEL}}

Included-item statement:
{{INCLUDED_STATEMENT}}

Footer disclaimer:
"Diagram is provided as a location and identification reference. Only the
highlighted component is included. Verify the OEM number, photographs and
fitment details before purchase."

VISUAL STYLE
- Professional automotive technical-document style
- Crisp vector-like linework
- Strong visual hierarchy
- Large, readable text
- Consistent spacing and alignment
- Minimal design
- No shadows, gradients, 3D effects or photorealistic rendering
- No unnecessary icons
- No spelling errors
- No small unreadable text
- No logos unless a seller logo is supplied
- No eBay logo
- No pricing, discount, shipping or warranty claims

OUTPUT
Return one high-resolution square PNG suitable as a supplemental eBay listing
image. The final image must communicate immediately which component is being
sold without implying that the complete assembly is included.

NEGATIVE CONSTRAINTS
${OEM_NEGATIVE}`;

const LOCATION_GUIDE_PROMPT = `Create a clearly labeled non-OEM automotive location guide for the supplied
part.

Use the uploaded photograph of the actual part as the primary visual reference.
Create a simplified grayscale outline of the relevant vehicle area or assembly
and indicate the approximate installation location with a highlighted marker.

Prominently label the image:
"ILLUSTRATIVE LOCATION GUIDE — NOT AN OEM DIAGRAM"

Do not create an exploded assembly. Do not invent mounting hardware, connectors,
part numbers, adjacent components or technical details. Use only verified
listing information.

LISTING DATA
Listing title: {{LISTING_TITLE}}
Part name: {{PART_NAME}}
OEM part number: {{OEM_PART_NUMBER}}
Vehicle: {{YEAR}} {{MAKE}} {{MODEL}}
Trim or chassis: {{TRIM_OR_CHASSIS}}
Engine: {{ENGINE}}
Part position: {{PART_POSITION}}
Quantity included: {{QUANTITY_INCLUDED}}
Additional included components: {{OTHER_INCLUDED_COMPONENTS_OR_NONE}}

IMAGE DESIGN
Create a square 1600 × 1600 px automotive listing image.

Background:
- Pure white
- Clean, professional and uncluttered

Layout:
- Place the part photograph prominently
- Add a simplified grayscale location sketch of the relevant vehicle area
- Mark approximate installation location with one teal highlight marker
- Keep typography large and readable

Header:
ILLUSTRATIVE LOCATION GUIDE — NOT AN OEM DIAGRAM

Identification panel:
PART: {{PART_NAME}}
OEM NUMBER: {{OEM_PART_NUMBER}}
POSITION: {{PART_POSITION}}
VEHICLE: {{YEAR}} {{MAKE}} {{MODEL}}

Included-item statement:
{{INCLUDED_STATEMENT}}

Footer disclaimer:
"This is an illustrative location guide, not an OEM diagram. Only the part
shown in the photographs is included. Verify the OEM number, photographs and
fitment details before purchase."

VISUAL STYLE
- Professional automotive technical-document style
- Minimal design
- No shadows, gradients, 3D effects or photorealistic vehicle rendering
- No eBay logo, pricing, or promotional claims

NEGATIVE CONSTRAINTS
${GUIDE_NEGATIVE}`;

export function buildLocationDiagramPrompt(
  mode: LocationDiagramMode,
  data: LocationDiagramListingData,
): { prompt: string; negativePrompt: string } {
  if (mode === 'oem_callout') {
    return {
      prompt: fill(OEM_PROMPT, data),
      negativePrompt: OEM_NEGATIVE,
    };
  }
  return {
    prompt: fill(LOCATION_GUIDE_PROMPT, data),
    negativePrompt: GUIDE_NEGATIVE,
  };
}

export const MANUAL_REVIEW_MARKER =
  'MANUAL REVIEW REQUIRED — TARGET COMPONENT NOT VERIFIED';

export function isManualReviewResponse(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.toUpperCase().includes('MANUAL REVIEW REQUIRED');
}
