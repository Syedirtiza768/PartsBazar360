/**
 * Prompt templates for title and description generation.
 */

export function buildTitleDescriptionSystemPrompt(): string {
  return `You are a marketplace listing copywriter for automotive parts.
Generate optimized titles, descriptions, and buyer-facing content.

RULES:
- Titles must follow the marketplace character limit (80 chars for eBay).
- Put the strongest searchable attributes first.
- Include: brand, product type, OEM/MPN, placement, condition when relevant.
- Avoid keyword stuffing.
- Avoid unsupported compatibility claims.
- Avoid promotional language ("best", "guaranteed", "premium").
- Condition description must be factual and honest.
- Buyer verification notice should encourage the buyer to verify fitment.

Return ONLY valid JSON:
{
  "optimizedTitle": "string - max 80 characters",
  "conditionDescription": "string - factual condition description",
  "shortDescription": "string - 2-3 sentence product summary",
  "keyFeatures": ["array of 3-7 key features"],
  "buyerVerificationNotice": "string - notice encouraging buyer to verify part number and fitment",
  "compatibilityDisclaimer": "string - disclaimer about fitment verification",
  "recommendedImageLabels": ["array of suggested labels for listing images"]
}`;
}

export function buildTitleDescriptionUserPrompt(input: {
  title?: string;
  brand?: string;
  partNumber?: string;
  oeNumbers?: string[];
  condition?: string;
  partType?: string;
  placement?: string;
  vehicleSystem?: string;
  compatibility?: Array<Record<string, unknown>>;
  itemSpecifics?: Array<Record<string, unknown>>;
  imageAnalysis?: Record<string, unknown>;
  marketplace?: string;
}): string {
  const lines: string[] = ['Generate optimized listing content:\n'];

  if (input.title) lines.push(`Original title: ${input.title}`);
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.partNumber) lines.push(`MPN: ${input.partNumber}`);
  if (input.oeNumbers?.length)
    lines.push(`OE Numbers: ${input.oeNumbers.join(', ')}`);
  if (input.condition) lines.push(`Condition: ${input.condition}`);
  if (input.partType) lines.push(`Part Type: ${input.partType}`);
  if (input.placement) lines.push(`Placement: ${input.placement}`);
  if (input.vehicleSystem) lines.push(`Vehicle System: ${input.vehicleSystem}`);
  if (input.marketplace) lines.push(`Target marketplace: ${input.marketplace}`);

  if (input.compatibility?.length) {
    const makes = [
      ...new Set(input.compatibility.map((c) => c.make).filter(Boolean)),
    ];
    const models = [
      ...new Set(input.compatibility.map((c) => c.model).filter(Boolean)),
    ];
    const years = input.compatibility
      .map((c) => Number(c.year))
      .filter((y) => y > 0);
    const yearRange =
      years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : '';
    lines.push(
      `\nCompatibility: ${makes.join(', ')} ${models.join(', ')} ${yearRange}`,
    );
    lines.push(`(${input.compatibility.length} fitment rows)`);
  }

  const verifiedSpecifics = (input.itemSpecifics || []).filter(
    (s) => s.autoPublish === true,
  );
  if (verifiedSpecifics.length > 0) {
    lines.push('\nVerified item specifics:');
    for (const spec of verifiedSpecifics.slice(0, 15)) {
      lines.push(`  ${String(spec.field)}: ${String(spec.value)}`);
    }
  }

  return lines.join('\n');
}
