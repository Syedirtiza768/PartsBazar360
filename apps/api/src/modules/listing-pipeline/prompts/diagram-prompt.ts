import type { DiagramLabel } from '../types';

/**
 * Build the system prompt for diagram-generation instruction creation.
 */
export function buildDiagramSystemPrompt(): string {
  return `You are a technical illustration specialist for automotive parts marketplace listings.
Your job is to generate detailed image-generation prompts that create professional listing diagrams.

RULES:
- Use the real uploaded product image as the primary source.
- Do NOT replace the actual product with an invented or visually different part.
- Do NOT add unverified features, connectors, dimensions, or compatibility claims.
- Keep designs professional and uncluttered.
- Use readable typography and strong visual hierarchy.
- Use a plain or transparent background where appropriate.
- Avoid copyrighted logos unless already visible on the product.
- Do NOT add marketplace logos.
- Do NOT generate misleading visuals for used products.
- Clearly distinguish observed facts from informational labels.
- Preserve the product's actual shape, condition, color, and visible characteristics.
- Output 2000x2000 pixels, square format.
- Keep critical content away from outer edges (safe zone: 100px from each edge).

DIAGRAM TYPES (choose the most appropriate):
1. annotated_photo - Labels directly on the product photo
2. technical_callout - Arrows and callout boxes pointing to key features
3. placement_diagram - Shows where the part sits on a vehicle
4. dimensions_diagram - Shows measurements (only when verified data exists)
5. connector_mounting - Focus on connectors, pins, and mounting points
6. compatibility_verification - Shows OEM number location and verification points
7. combination - Multiple diagram types combined

Return ONLY valid JSON:
{
  "diagramType": "one of the types above",
  "prompt": "detailed image generation prompt (200-400 words)",
  "negativePrompt": "what to avoid in the generated image",
  "labels": [
    {
      "text": "label text",
      "position": "where on the image (e.g., top-left, center, bottom-right, arrow-target)",
      "type": "callout | arrow | warning | info | dimension",
      "verified": true/false
    }
  ],
  "reasoning": "why this diagram type was chosen"
}`;
}

/**
 * Build the user prompt for diagram generation.
 */
export function buildDiagramUserPrompt(input: {
  title?: string;
  brand?: string;
  partNumber?: string;
  condition?: string;
  partType?: string;
  placement?: string;
  imageAnalysis?: Record<string, unknown>;
  itemSpecifics?: Array<Record<string, unknown>>;
  compatibility?: Array<Record<string, unknown>>;
  isAutomotive?: boolean;
}): string {
  const lines: string[] = ['Generate a diagram prompt for this product:\n'];

  if (input.title) lines.push(`Title: ${input.title}`);
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.partNumber) lines.push(`Part Number: ${input.partNumber}`);
  if (input.condition) lines.push(`Condition: ${input.condition}`);
  if (input.partType) lines.push(`Part Type: ${input.partType}`);
  if (input.placement) lines.push(`Placement: ${input.placement}`);

  if (input.imageAnalysis) {
    const ia = input.imageAnalysis;
    lines.push('\n--- Image Analysis ---');
    if (ia.productType) lines.push(`Product: ${String(ia.productType)}`);
    if (ia.orientation) lines.push(`Orientation: ${String(ia.orientation)}`);
    if (ia.visibleFeatures)
      lines.push(`Features: ${(ia.visibleFeatures as string[]).join(', ')}`);
    if (ia.connectors)
      lines.push(`Connectors: ${(ia.connectors as string[]).join(', ')}`);
    if (ia.mountingPoints)
      lines.push(`Mounting: ${(ia.mountingPoints as string[]).join(', ')}`);
    if (ia.materialIndicators)
      lines.push(
        `Materials: ${(ia.materialIndicators as string[]).join(', ')}`,
      );
    if (ia.colorDescription)
      lines.push(`Color: ${String(ia.colorDescription)}`);
    if (ia.vehiclePlacementClues)
      lines.push(
        `Vehicle placement clues: ${String(ia.vehiclePlacementClues)}`,
      );
    if (ia.imageQuality) {
      const iq = ia.imageQuality as Record<string, unknown>;
      lines.push(
        `Image quality: resolution=${String(iq.resolution)}, suitable for diagram=${String(iq.suitableForDiagram)}`,
      );
    }
  }

  if (input.isAutomotive) {
    lines.push(
      '\nThis is an AUTOMOTIVE PART. The diagram should clearly communicate:',
    );
    lines.push('- Placement on vehicle (if determinable)');
    lines.push('- Driver/passenger side (if applicable)');
    lines.push('- Front/rear position (if applicable)');
    lines.push('- Visible connectors and their locations');
    lines.push('- Mounting points');
    lines.push('- OEM number location on the part');
    lines.push('- Whether individual part or assembly');
    lines.push('- "Verify part number before purchase" notice');
  }

  const verifiedSpecifics = (input.itemSpecifics || []).filter(
    (s) =>
      s.verificationStatus === 'verified' ||
      s.verificationStatus === 'probable',
  );
  if (verifiedSpecifics.length > 0) {
    lines.push('\n--- Verified Details for Labels ---');
    for (const spec of verifiedSpecifics.slice(0, 10)) {
      lines.push(`${String(spec.field)}: ${String(spec.value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build fallback labels when the diagram model cannot generate them.
 */
export function buildFallbackLabels(input: {
  brand?: string;
  partNumber?: string;
  partType?: string;
  placement?: string;
  condition?: string;
}): DiagramLabel[] {
  const labels: DiagramLabel[] = [];

  if (input.brand) {
    labels.push({
      text: `Brand: ${input.brand}`,
      position: 'top-left',
      type: 'info',
      verified: true,
    });
  }
  if (input.partNumber) {
    labels.push({
      text: `OEM/MPN: ${input.partNumber}`,
      position: 'top-right',
      type: 'callout',
      verified: true,
    });
  }
  if (input.partType) {
    labels.push({
      text: input.partType,
      position: 'bottom-left',
      type: 'info',
      verified: true,
    });
  }
  if (input.placement) {
    labels.push({
      text: `Placement: ${input.placement}`,
      position: 'bottom-right',
      type: 'callout',
      verified: true,
    });
  }

  labels.push({
    text: 'Verify part number before purchase',
    position: 'bottom-center',
    type: 'warning',
    verified: true,
  });

  return labels;
}
